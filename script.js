let username = prompt("Username: ");
let username_ok = false;
let msgBox = document.getElementById('msgs-box');
let input = document.getElementById('msg-input');
let users = new Map();

input.addEventListener('blur', () => input.focus());
input.focus();

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsHost = "chat.waffledogz.us";
const socket = new WebSocket(`${wsProtocol}//${wsHost}/ws`);

socket.addEventListener("error", (e) => alert("WS error: " + e));
socket.addEventListener("close", (e) => alert("WS closed: " + e.code + " " + e.reason));

socket.addEventListener("open", () => {
  socket.send("&u" + username);
});

function addMessage(message, color) {
  addMessageAt(message, color, Date.now());
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function addMessageAt(message, color, timestamp) {
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
  msgBox.prepend(txt);
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
  let dj = JSON.parse(d)

  let event_type = dj.event;

  if (!username_ok) {
    if (event_type == "uname-eval") {
      if (dj.result == "ok") {
	username_ok = true;
      }
      else if (dj.result == "taken") {
	alert("username taken :(");
	username = prompt("Username: ");
	socket.send("&u" + username);
      }
    }
    return;
  }
  if (!has_gotten_users) {
    socket.send("&i");
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
      addMessageAt(`<${users.get(dj.id).username}> joined.`, users.get(dj.id).color, dj.timestamp ?? Date.now())
      return;
    }
    case "userleft": {
      document.getElementById("s-u-" + dj.id).remove();
      let txt = document.createElement("p");
      addMessageAt(`<${users.get(dj.id).username}> left.`,users.get(dj.id).color, dj.timestamp ?? Date.now())

      users.delete(dj.id);
      return;
    }
    case "msg": {
      const user = users.get(dj.id);
      const messageUsername = dj.username ?? user?.username ?? "unknown";
      const messageColor = dj.color ?? user?.color ?? "white";
      addMessageAt(`<${messageUsername}> ` + dj.msg, messageColor, dj.timestamp ?? Date.now());
      return;
    }
  }
});

function send(event) {
  if (event && event.keyCode != 13) return;
  let input_txt = input.value;
  if (input_txt.trim() == "") return;
  socket.send(input_txt);
  input.value = "";
  input.focus();
}
