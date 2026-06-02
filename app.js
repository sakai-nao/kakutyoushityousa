const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const fileStatus = document.querySelector("#fileStatus");
const fileName = document.querySelector("#fileName");
const fileSize = document.querySelector("#fileSize");
const previewMode = document.querySelector("#previewMode");
const previewStage = document.querySelector("#previewStage");
const clearButton = document.querySelector("#clearButton");
const previewButtons = document.querySelectorAll(".preview-button");

let selectedFile = null;
let currentUrl = null;

const previewTypes = {
  image: {
    label: "JPEG画像として確認中",
    async build(bytes, file) {
      return buildImagePreview(bytes, file);
    },
  },
  audio: {
    label: "MP3音声として確認中",
    async build(bytes, file) {
      return buildAudioPreview(bytes, file);
    },
  },
  text: {
    label: "TXTテキストとして確認中",
    async build(bytes, file) {
      return buildTextPreview(bytes, file);
    },
  },
  binary: {
    label: "バイナリデータを表示中",
    async build(bytes) {
      return buildBinaryPreview(bytes);
    },
  },
};

function setFile(file) {
  selectedFile = file;
  fileStatus.textContent = "調査中";
  fileName.textContent = file.name || "名前なし";
  fileSize.textContent = formatBytes(file.size);
  previewMode.textContent = "未選択";
  previewStage.innerHTML = "<p>表示形式のボタンを押して、中身を調べてください。</p>";
  previewButtons.forEach((button) => {
    button.disabled = false;
  });
  cleanupPreview();
}

async function previewAs(kind) {
  if (!selectedFile) {
    showError("先にファイルを選択してください。");
    return;
  }

  cleanupPreview();
  const type = previewTypes[kind];
  previewMode.textContent = type.label;
  previewStage.innerHTML = "<p>ファイルのバイト列を読み取っています。</p>";

  try {
    const bytes = new Uint8Array(await selectedFile.arrayBuffer());
    previewStage.replaceChildren(await type.build(bytes, selectedFile));
  } catch (error) {
    showError("変換中にエラーが発生しました。");
  }
}

function buildImagePreview(bytes, file) {
  const image = document.createElement("img");
  image.alt = "JPEGとして読み込んだプレビュー";
  image.src = createNativeUrl(file, "image/jpeg");

  const wrapper = wrapPreview(image, "JPEG画像として読み込んでいます。");
  const note = wrapper.querySelector(".decode-note");

  image.addEventListener("load", () => {
    note.textContent = "JPEG画像としてプレビューしています。";
  }, { once: true });

  image.addEventListener("error", () => {
    releaseCurrentUrl();
    const fallback = buildByteImage(bytes);
    wrapper.replaceChildren(...fallback.childNodes);
  }, { once: true });

  return wrapper;
}

function buildAudioPreview(bytes, file) {
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = createNativeUrl(file, "audio/mpeg");

  const wrapper = wrapPreview(audio, "MP3音声として読み込んでいます。");
  const note = wrapper.querySelector(".decode-note");

  const showNativeReady = () => {
    note.textContent = "MP3音声として再生できます。";
  };

  audio.addEventListener("canplay", showNativeReady, { once: true });

  const useFallback = () => {
    releaseCurrentUrl();
    audio.removeEventListener("canplay", showNativeReady);
    audio.removeEventListener("error", useFallback);
    audio.src = createWavUrl(bytes);
    audio.load();
    note.textContent = "MP3音声としては展開できないため、バイト列を波形に変換しています。";
  };

  audio.addEventListener("error", useFallback);
  return wrapper;
}

function buildByteImage(bytes) {
  const canvas = document.createElement("canvas");
  const side = Math.max(64, Math.min(512, Math.ceil(Math.sqrt(bytes.length / 3))));
  const pixelCount = side * side;
  canvas.width = side;
  canvas.height = side;

  const context = canvas.getContext("2d");
  const imageData = context.createImageData(side, side);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sourceIndex = (pixel * 3) % Math.max(bytes.length, 1);
    const targetIndex = pixel * 4;
    imageData.data[targetIndex] = bytes[sourceIndex] ?? 0;
    imageData.data[targetIndex + 1] = bytes[sourceIndex + 1] ?? bytes[sourceIndex] ?? 0;
    imageData.data[targetIndex + 2] = bytes[sourceIndex + 2] ?? bytes[sourceIndex] ?? 0;
    imageData.data[targetIndex + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  canvas.className = "byte-canvas";
  canvas.setAttribute("aria-label", "ファイルのバイト列をRGB画素に変換した画像");
  return wrapPreview(canvas, "1バイトずつ色の成分として並べています。元のファイル形式とは関係なく、データの並びが模様になります。");
}

function buildByteAudio(bytes) {
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = createWavUrl(bytes);
  return wrapPreview(audio, "バイトの値を音の波形に変換しています。元データによってノイズや電子音のように聞こえます。");
}

function createWavUrl(bytes) {
  const sampleRate = 22050;
  const seconds = 4;
  const sampleCount = sampleRate * seconds;
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const byte = bytes[sample % Math.max(bytes.length, 1)] ?? 128;
    const previous = bytes[(sample - 1 + bytes.length) % Math.max(bytes.length, 1)] ?? 128;
    const shaped = ((byte - 128) * 180 + (previous - 128) * 76) | 0;
    view.setInt16(44 + sample * 2, Math.max(-32768, Math.min(32767, shaped)), true);
  }

  currentUrl = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  return currentUrl;
}

function createNativeUrl(file, mimeType) {
  currentUrl = URL.createObjectURL(file.slice(0, file.size, mimeType));
  return currentUrl;
}

function buildTextPreview(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const preview = createTextBlock(text || "(空のテキストファイル)");
    return wrapPreview(preview, "UTF-8のTXTテキストとして表示しています。");
  } catch (error) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const preview = createTextBlock(text || "(空のテキストファイル)");
    return wrapPreview(preview, "UTF-8の文字コードとして無理やり当てはめて表示しています。読めない部分は置換文字になります。");
  }
}

function createTextBlock(text) {
  const pre = document.createElement("pre");
  pre.className = "text-preview";
  pre.textContent = text.slice(0, 12000);
  if (text.length > 12000) {
    pre.textContent += "\n\n... 以降は省略しました";
  }
  return pre;
}

function buildBinaryPreview(bytes) {
  const preview = createTextBlock(createBinaryText(bytes));
  preview.classList.add("binary-preview");
  return wrapPreview(preview, "左から位置、16進数のバイト列を表示しています。");
}

function createBinaryText(bytes) {
  const rows = [];
  const limit = Math.min(bytes.length, 4096);

  for (let offset = 0; offset < limit; offset += 16) {
    const chunk = bytes.slice(offset, offset + 16);
    const hex = Array.from(chunk, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    rows.push(`${offset.toString(16).padStart(8, "0")}  ${hex}`);
  }

  if (bytes.length > limit) {
    rows.push("");
    rows.push("... 以降は省略しました");
  }

  return rows.join("\n");
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function wrapPreview(element, noteText) {
  const wrapper = document.createElement("div");
  wrapper.className = "converted-preview";

  const note = document.createElement("div");
  note.className = "decode-note";
  note.textContent = noteText;

  wrapper.append(element, note);
  return wrapper;
}

function showError(message) {
  const errorBox = document.createElement("div");
  errorBox.className = "error-box";
  errorBox.textContent = message;
  previewStage.replaceChildren(errorBox);
}

function cleanupPreview() {
  releaseCurrentUrl();
}

function releaseCurrentUrl() {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) setFile(file);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  const [file] = event.dataTransfer.files;
  if (file) setFile(file);
});

previewButtons.forEach((button) => {
  button.disabled = true;
  button.addEventListener("click", () => previewAs(button.dataset.kind));
});

clearButton.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  fileStatus.textContent = "ファイル未選択";
  fileName.textContent = "-";
  fileSize.textContent = "-";
  previewMode.textContent = "未選択";
  previewStage.innerHTML = "<p>ファイルを選んで、表示形式のボタンを押してください。</p>";
  previewButtons.forEach((button) => {
    button.disabled = true;
  });
  cleanupPreview();
});
