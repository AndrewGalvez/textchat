let username = localStorage.getItem("chat_name");
let userColor = localStorage.getItem("chat_color");

if (username == null || username.length === 0) {
  window.location.href = `./name.html?v=${Date.now()}`;
  throw new Error("Missing username; redirecting to name page.");
}

if (typeof userColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(userColor)) {
  userColor = null;
}

let username_ok = false;
let msgBox = document.getElementById('msgs-box');
let input = document.getElementById('msg-input');
let photoInput = document.getElementById('photo-input');
let sendPhotoBtn = document.getElementById('send-photo-btn');
let fileInput = document.getElementById('file-input');
let sendFileBtn = document.getElementById('send-file-btn');
let imageOverlay = document.getElementById('image-overlay');
let overlayImg = document.getElementById('overlay-img');
let users = new Map();
let users_typing = Array();
let typing = false;
let typing_t = false;
let photoPickerActive = false;
const typing_timer = 500;
const outlinedChatTextStrokeWidth = "0.0001px";
let soundEnabled = true;
let messages = Array();
let lastRenderedMessageIndex = 0;

const imageMaxWidth = 1280;
const imageMaxHeight = 1280;
const imageQuality = 0.375;
const maxTextFileBytes = 128 * 1024;

function detectLanguage(filename) {
  const lower = (filename || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  const languageByExtension = {
    ".c": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".cxx": "cpp",
    ".h": "cpp",
    ".hpp": "cpp",
    ".css": "css",
    ".csv": "",
    ".go": "go",
    ".html": "markup",
    ".htm": "markup",
    ".ini": "",
    ".java": "java",
    ".js": "javascript",
    ".json": "json",
    ".jsx": "jsx",
    ".log": "",
    ".md": "markdown",
    ".py": "python",
    ".rs": "rust",
    ".sh": "bash",
    ".toml": "toml",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".txt": "",
    ".xml": "markup",
    ".yaml": "yaml",
    ".yml": "yaml",
  };
  return languageByExtension[ext] ?? "";
}

async function compressImage(file) {
  let quality = imageQuality;
  let maxWidth = imageMaxWidth;
  let maxHeight = imageMaxHeight;

  if (!(file instanceof Blob)) {
    throw new Error("compressImage wants File/Blob input");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objectUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(
        new Error(`image decode failed for "${file.name || "upload"}" (${file.type || "unknown type"})`)
      );
    });

    const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("could not create ctx in compressImage");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const outputType = "image/jpeg";
    const compressedBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("no blob produced"));
            return;
          }
          resolve(blob);
        },
        outputType,
        quality
      );
    });

    return compressedBlob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

input.addEventListener('blur', () => input.focus());
input.focus();

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsHost = "localhost:8080";
const wsUrl = `${wsProtocol}//${wsHost}/ws`;
const socket = new WebSocket(wsUrl);
let movedToErrorPage = false;
let socketClosedByNavigation = false;
let wsSendStateReported = false;

function wsStateName(state) {
  switch (state) {
    case WebSocket.CONNECTING: return "CONNECTING";
    case WebSocket.OPEN: return "OPEN";
    case WebSocket.CLOSING: return "CLOSING";
    case WebSocket.CLOSED: return "CLOSED";
    default: return `UNKNOWN(${state})`;
  }
}

console.info("[ws] init", {
  url: wsUrl,
  protocol: wsProtocol,
  host: wsHost,
  page: window.location.href,
  userAgent: navigator.userAgent
});

function reportChatError(context, err) {
  let details = "";
  if (err) {
    if (typeof err === "string") {
      details = err;
    } else if (err instanceof Event) {
      const tag = err.target && err.target.tagName ? String(err.target.tagName).toLowerCase() : "unknown";
      details = `event:${err.type} target:<${tag}>`;
    } else if (err.message) {
      details = err.message;
    } else if (err.reason) {
      details = err.reason;
    } else {
      details = String(err);
    }
  }
  const text = details ? `${context}: ${details}` : context;
  console.error(text, err);
  addMessage(`[error] ${text}`, "red");
}

function safeSendWs(data, context) {
  if (socket.readyState === WebSocket.OPEN) {
    wsSendStateReported = false;
    console.debug("[ws] send", {
      context: context || "",
      type: typeof data,
      bytes: typeof data === "string" ? data.length : (data?.byteLength ?? 0),
      readyState: wsStateName(socket.readyState)
    });
    socket.send(data);
    return true;
  }
  console.warn("[ws] blocked send", {
    context: context || "",
    readyState: wsStateName(socket.readyState),
    hidden: document.visibilityState
  });
  if (!wsSendStateReported) {
    reportChatError(context || "send failed", "websocket is not connected");
    wsSendStateReported = true;
  }
  return false;
}

socket.addEventListener("error", (event) => {
  console.error("[ws] error event", event, {
    readyState: wsStateName(socket.readyState),
    hidden: document.visibilityState
  });
  reportChatError("websocket error", event);
});

socket.addEventListener("close", (event) => {
  if (socketClosedByNavigation) return;
  wsSendStateReported = false;
  console.warn("[ws] close", {
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean,
    readyState: wsStateName(socket.readyState),
    hidden: document.visibilityState
  });
  reportChatError(
    `websocket closed (code ${event.code})`,
    event.reason || "no reason provided"
  );

  // If the socket dies before login completes, one automatic retry mirrors
  // the manual refresh that currently fixes phone Safari.
  if (!username_ok) {
    const retryKey = "ws_initial_retry_done";
    if (!sessionStorage.getItem(retryKey)) {
      sessionStorage.setItem(retryKey, "1");
      setTimeout(() => window.location.reload(), 250);
    }
  }
});

function closeSocketForNavigation() {
  if (socketClosedByNavigation) return;
  if (socket.readyState !== WebSocket.OPEN) return;
  socketClosedByNavigation = true;
  try {
    socket.send("&s");
  } catch (_) {}
  try {
    socket.close(1000, "navigation");
  } catch (_) {}
}

window.addEventListener("beforeunload", closeSocketForNavigation);

socket.addEventListener("open", () => {
  wsSendStateReported = false;
  sessionStorage.removeItem("ws_initial_retry_done");
  console.info("[ws] open", {
    readyState: wsStateName(socket.readyState),
    hidden: document.visibilityState
  });
  renderSys(`[system] wsHost: ${wsHost}`, "var(--aqua)", Date.now());
  safeSendWs(
    "&u" +
      JSON.stringify({
        username,
        color: userColor,
      }),
    "login send failed"
  );
});

const notifAudio = new Audio("/notif.mp3");
let audioUnlocked = false;

document.addEventListener("keydown", () => {
  if (!audioUnlocked) {
    notifAudio.play().then(()=>{notifAudio.pause();notifAudio.currentTime=0;});audioUnlocked=true;}});

function playNotificationBeep() {
  if (!soundEnabled) return;
  notifAudio.currentTime = 0;
  notifAudio.play().catch(()=>{});
}

function addMessage(message, color) {
  playNotificationBeep();
  renderSys(message, color, Date.now());
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function shouldOutlineChatName(color) {
  if (typeof color !== "string") return false;
  const normalizedColor = color.replace(/\s+/g, "").toLowerCase();
  return normalizedColor === "rgb(35,42,46)" || normalizedColor === "#232a2e";
}

function applyOutlinedChatTextStyles(element) {
  element.style.webkitTextStroke = `${outlinedChatTextStrokeWidth} white`;
  element.style.textStroke = `${outlinedChatTextStrokeWidth} white`;
  element.style.textShadow = "-1px 0 white, 0 1px white, 1px 0 white, 0 -1px white";
}

function renderSys(message, color = "white", timestamp = Date.now()) {
  let txt = document.createElement("p");
  let time = formatTimestamp(timestamp);
  let timespan = document.createElement("span");
  timespan.innerHTML = `[${time}]&emsp;`; 
  timespan.style.cssText = "color: var(--border); font-size: 12px;";
  let msgspan = document.createElement("span");
  msgspan.textContent = message;
  msgspan.style.color = color;
  txt.appendChild(timespan);
  txt.appendChild(msgspan);
  txt.style.color = color;
  txt.className = "chat-msg";
  txt.dataset.kind = "system";
  msgBox.prepend(txt);
}

function shouldGroup(senderId) {
  const prev = msgBox.firstElementChild;
  if (!prev) return false;
  return prev.dataset.kind === "user" && prev.dataset.sender === senderId;
}

function stampUserMsg(node, senderId) {
  node.dataset.kind = "user";
  node.dataset.sender = senderId;
}

function getGroupedIndentPx(username, color, timestamp) {
  const probe = document.createElement("p");
  const time = formatTimestamp(timestamp);
  const timespan = document.createElement("span");
  const namespan = document.createElement("span");

  probe.className = "chat-msg";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.whiteSpace = "pre";
  probe.style.margin = "0";

  timespan.textContent = `[${time}]\u2003`;
  timespan.style.cssText = "color: var(--border); font-size: 12px;";

  namespan.textContent = `<${username}> `;
  namespan.style.color = color;
  if (shouldOutlineChatName(color)) {
    applyOutlinedChatTextStyles(namespan);
  }

  probe.appendChild(timespan);
  probe.appendChild(namespan);
  msgBox.appendChild(probe);
  const width = Math.ceil(probe.getBoundingClientRect().width);
  probe.remove();
  return width;
}

function renderText(username, message, color, timestamp, grouped, senderId) {
  let txt = document.createElement("p");
  let time = formatTimestamp(timestamp);
  let timespan = document.createElement("span");
  let namespan = document.createElement("span");
  let msgspan = document.createElement("span");

  timespan.innerHTML = `[${time}]&emsp;`;
  timespan.style.cssText = "color: var(--border); font-size: 12px;";

  namespan.textContent = `<${username}> `;
  namespan.style.color = color;
  if (shouldOutlineChatName(color)) {
    applyOutlinedChatTextStyles(namespan);
  }

  msgspan.textContent = message;
  msgspan.style.color = "white";

  if (!grouped) {
    txt.appendChild(timespan);
    txt.appendChild(namespan);
  }
  txt.appendChild(msgspan);
  txt.style.color = color;
  txt.className = grouped ? "chat-msg grouped-msg" : "chat-msg";
  txt.style.marginLeft = grouped ? `${getGroupedIndentPx(username, color, timestamp)}px` : "0";
  stampUserMsg(txt, senderId);
  msgBox.prepend(txt);
}

function renderImage(username, mime, base64Data, color, timestamp, grouped, senderId) {
  let txt = document.createElement("p");
  let time = formatTimestamp(timestamp);
  const indentPx = getGroupedIndentPx(username, color, timestamp);
  let timespan = document.createElement("span");
  let namespan = document.createElement("span");
  let img = document.createElement("img");

  timespan.innerHTML = `[${time}]&emsp;`;
  timespan.style.cssText = "color: var(--border); font-size: 12px;";

  namespan.textContent = `<${username}> `;
  namespan.style.color = color;
  if (shouldOutlineChatName(color)) {
    applyOutlinedChatTextStyles(namespan);
  }

  img.src = `data:${mime};base64,${base64Data}`;
  img.alt = `${username} photo`;
  img.style.display = "block";
  img.style.marginTop = "6px";
  img.style.maxWidth = "260px";
  img.style.width = "100%";
  img.style.marginLeft = grouped ? "0" : `${indentPx}px`;
  img.style.borderRadius = "8px";
  img.style.border = "1px solid var(--border)";
  img.style.cursor = "pointer";
  img.className = "clickable";

  if (!grouped) {
    txt.appendChild(timespan);
    txt.appendChild(namespan);
  }
  txt.appendChild(document.createElement("br"));
  txt.appendChild(img);
  txt.className = grouped ? "chat-msg grouped-msg" : "chat-msg";
  txt.style.marginLeft = grouped ? `${indentPx}px` : "0";
  stampUserMsg(txt, senderId);
  msgBox.prepend(txt);
}

function renderFile(username, filename, content, language, color, timestamp, grouped, senderId) {
  let txt = document.createElement("div");
  let header = document.createElement("div");
  let toggleBtn = document.createElement("button");
  let time = formatTimestamp(timestamp);
  let timespan = document.createElement("span");
  let namespan = document.createElement("span");
  let filespan = document.createElement("span");
  let pre = document.createElement("pre");
  let code = document.createElement("code");

  timespan.innerHTML = `[${time}]&emsp;`;
  timespan.style.cssText = "color: var(--border); font-size: 12px;";

  namespan.textContent = `<${username}> `;
  namespan.style.color = color;
  if (shouldOutlineChatName(color)) {
    applyOutlinedChatTextStyles(namespan);
  }

  filespan.textContent = `uploaded ${filename}`;
  filespan.style.color = "var(--fg)";

  toggleBtn.type = "button";
  toggleBtn.textContent = "Minimize";
  toggleBtn.className = "file-toggle-btn";

  code.textContent = content;
  if (language) {
    code.className = `language-${language}`;
  }
  pre.appendChild(code);

  if (!grouped) {
    header.appendChild(timespan);
    header.appendChild(namespan);
  }
  header.appendChild(filespan);
  header.appendChild(toggleBtn);
  header.className = "file-msg-header";

  txt.appendChild(header);
  txt.appendChild(pre);
  txt.className = grouped ? "chat-msg file-msg grouped-msg" : "chat-msg file-msg";
  txt.style.marginLeft = grouped ? `${getGroupedIndentPx(username, color, timestamp)}px` : "0";
  stampUserMsg(txt, senderId);
  msgBox.prepend(txt);

  toggleBtn.addEventListener("click", () => {
    const isMinimized = pre.classList.toggle("hidden");
    toggleBtn.textContent = isMinimized ? "Expand" : "Minimize";
  });

  if (window.Prism) {
    Prism.highlightElement(code);
  }
}

function renderSingleMessage(message) {
  if (!message || !message.user) return;
  const u = message.user;
  const v = message.value;
  const t = message.timestamp;
  if (message.contentType === "system") return renderSys(v.text || "", v.color || "white", t);
  const senderId = u.id || u.username || "unknown";
  const grouped = shouldGroup(senderId);

  if (message.contentType === "text") return renderText(u.username, v, u.color, t, grouped, senderId);
  if (message.contentType === "image") return renderImage(u.username, v.mime || "image/jpeg", v.base64Data || "", u.color, t, grouped, senderId);
  if (message.contentType === "file") return renderFile(u.username, v.filename || "file.txt", v.content || "", v.language || "", u.color, t, grouped, senderId);
}

function renderMessages() {
  if (lastRenderedMessageIndex >= messages.length) return;

  for (let i = lastRenderedMessageIndex; i < messages.length; i += 1) {
    renderSingleMessage(messages[i]);
  }

  lastRenderedMessageIndex = messages.length;
}

function queueIncomingMessage(message) {
  if (!message) return;
  messages.push(message);
  renderMessages();
}

function resolveMessageUser(dj) {
  const user = users.get(dj.id);
  return {
    id: String(dj.id ?? dj.username ?? ""),
    username: dj.username ?? user?.username ?? "unknown",
    color: dj.color ?? user?.color ?? "white"
  };
}

function normalizeIncomingMessage(dj) {
  if (!dj || typeof dj !== "object") return null;
  const user = resolveMessageUser(dj);
  const timestamp = dj.timestamp ?? Date.now();

  if (dj.event === "msg") {
    if (dj.msg === " joined." || dj.msg === " left.") {
      return {
        contentType: "system",
        value: {
          text: `<${user.username}>${dj.msg}`,
          color: "#f2c94c"
        },
        user,
        timestamp
      };
    }
    return {
      contentType: "text",
      value: String(dj.msg ?? ""),
      user,
      timestamp
    };
  }

  if (dj.event === "photo") {
    if (typeof dj.data !== "string" || dj.data.length === 0) return null;
    return {
      contentType: "image",
      value: {
        mime: dj.mime || "image/jpeg",
        base64Data: dj.data
      },
      user,
      timestamp
    };
  }

  if (dj.event === "file") {
    if (typeof dj.content !== "string" || typeof dj.filename !== "string") return null;
    return {
      contentType: "file",
      value: {
        filename: dj.filename,
        content: dj.content,
        language: typeof dj.language === "string" ? dj.language : ""
      },
      user,
      timestamp
    };
  }

  return null;
}

function addUser(id, user) {
	users.set(id,{username: user.username, color: user.color});
	let txt = document.createElement("p");
	txt.textContent = user.username;
	txt.id = "s-u-" + id;
	txt.style.color = users.get(id).color;
	document.getElementById("users-box").appendChild(txt);
}

let has_gotten_users = false;

socket.addEventListener("message", (event) => {
  let d = event.data;
  let dj;
  try {
    dj = JSON.parse(d);
  } catch (err) {
    reportChatError("invalid server json", err);
    return;
  }

  let event_type = dj.event;

  if (!username_ok) {
    if (event_type == "uname-eval") {
      if (dj.result == "ok") {
	username_ok = true;
      }
      else if (dj.result == "taken") {
        alert("username taken :(");
        localStorage.removeItem("chat_name");
        window.location.href = `./name.html?v=${Date.now()}`;
      }
    }
    return;
  }
  if (!has_gotten_users) {
    safeSendWs("&i", "failed to request users");
    has_gotten_users = true;
  }

  switch (event_type) {
    case "sendusers": {
      for (let [id,user] of Object.entries(dj.users)) {
	addUser(id,user);
      }
      return;
    }
    case "userjoin": {
      addUser(dj.id, {username: dj.username, color: dj.color});
      renderSys(`<${users.get(dj.id).username}> joined.`, "#f2c94c", dj.timestamp ?? Date.now())
      return;
    }
    case "userleft": {
      const user = users.get(dj.id);
      const userEl = document.getElementById("s-u-" + dj.id);
      if (userEl) {
        userEl.remove();
      }
      if (user) {
        renderSys(`<${user.username}> left.`, "#f2c94c", dj.timestamp ?? Date.now());
      }
      users_typing = users_typing.filter((id) => id !== dj.id);
      users.delete(dj.id);
      return;
    }
    case "msg": {
      queueIncomingMessage(normalizeIncomingMessage(dj));
      return;
    }
    case "photo": {
      queueIncomingMessage(normalizeIncomingMessage(dj));
      return;
    }
    case "file": {
      queueIncomingMessage(normalizeIncomingMessage(dj));
      return;
    }
    case "typing": {
      users_typing.push(dj.id);
      update_typing_span();
      console.log(users_typing);
      return;
    }
    case "stoptyping": {
      users_typing = users_typing.filter((id) => id !== dj.id);
      update_typing_span();
      console.log(users_typing);
      return;
    }
  }
});

let typing_reset_timeout;

function send(event) {
  if (event.keyCode != 13) {
  	typing = true;
 	 clearTimeout(typing_reset_timeout);
 	 typing_reset_timeout = setTimeout(()=>{typing=false},typing_timer);
  }
  if (event && event.keyCode != 13) return;
  
  let input_txt = input.value;
  if (input_txt.trim() == "") return;
  safeSendWs(input_txt, "failed to send message");
  input.value = "";
  input.focus();
}

async function send_image(file) {
  try {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      throw new Error("selected file is not an image");
    }
    const compressedBlob = await compressImage(file);
    const imageBuffer = await compressedBlob.arrayBuffer();
    if (!safeSendWs("&p", "failed to start image upload")) return;
    safeSendWs(imageBuffer, "failed to send image bytes");
  } catch (err) {
    reportChatError("failed to send image", err);
  }
}

async function send_text_file(file) {
  try {
    if (file.size > maxTextFileBytes) {
      throw new Error(`file is too large (max ${Math.floor(maxTextFileBytes / 1024)} KB)`);
    }

    const content = await file.text();
    if (content.includes("\u0000")) {
      throw new Error("binary files are not supported");
    }

    const language = detectLanguage(file.name);
    if (!safeSendWs("&f" + JSON.stringify({ filename: file.name, language }), "failed to start file upload")) {
      return;
    }

    const bytes = new TextEncoder().encode(content);
    safeSendWs(bytes, "failed to send file bytes");
  } catch (err) {
    reportChatError("failed to send file", err);
  }
}

function bindFilePicker(button, picker, onPick) {
  if (!button || !picker) return;

  button.addEventListener("click", () => {
    photoPickerActive = true;
    picker.click();
  });

  picker.addEventListener("change", async () => {
    photoPickerActive = false;
    const file = picker.files && picker.files[0];
    if (!file) return;
    await onPick(file);
    picker.value = "";
  });
}

bindFilePicker(sendPhotoBtn, photoInput, send_image);

if (sendPhotoBtn && photoInput) {
  window.addEventListener("focus", () => {
    if (!photoPickerActive) return;
    // File picker is closed (including cancel); release typing state.
    setTimeout(() => {
      photoPickerActive = false;
    }, 100);
  });
}

bindFilePicker(sendFileBtn, fileInput, send_text_file);

if (msgBox && imageOverlay && overlayImg) {
  msgBox.addEventListener("click", (event) => {
    const clicked = event.target;
    if (!(clicked instanceof HTMLImageElement)) return;
    if (!clicked.classList.contains("clickable")) return;
    overlayImg.src = clicked.src;
    imageOverlay.classList.remove("hidden");
  });

  imageOverlay.addEventListener("click", () => {
    imageOverlay.classList.add("hidden");
    overlayImg.src = "";
  });
}

window.addEventListener("error", (event) => {
  reportChatError("javascript error", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  reportChatError("unhandled promise rejection", event.reason);
});

function server_update_typing() {
  const isTypingNow = typing || photoPickerActive;
  if (isTypingNow != typing_t) {
    if (isTypingNow) {
      safeSendWs("&t", "failed to send typing start");
    }
    else {
      safeSendWs("&s", "failed to send typing stop");
    }
    typing_t = isTypingNow;
  }
}

function update_typing_span() {
  let spans = document.createElement("span");
  spans.id = "us-typing";
  spans.textContent = "Typing:"
  users_typing.forEach((id) => {
   let s = document.createElement("span");
   s.textContent = `<${users.get(id).username}>`;
   s.style.color = users.get(id).color; 
   s.className = "u-typing-span"
    spans.appendChild(s);
  })
  document.getElementById("us-typing").replaceWith(spans);
}

setInterval(server_update_typing, 30);
