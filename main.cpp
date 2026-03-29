#ifndef WINVER
#define WINVER 0x0A00
#endif

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif

#include "color.h"
#include "httplib.h"
#include "json.hpp"
#include <chrono>
#include <cctype>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <vector>

using nlohmann::json;

struct Client {
  httplib::ws::WebSocket *ws;
  std::string username;
  std::string color;
};

std::map<int, Client> clients;
std::mutex clients_mutex;
std::deque<std::string> message_history;
constexpr size_t MAX_HISTORY = 256;
constexpr long long IMAGE_EXPIRE_AFTER_MESSAGES = 30;
long long chat_message_index = 0;

long long current_timestamp_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

bool is_valid_hex_color(const std::string &value) {
  if (value.size() != 7 || value[0] != '#') {
    return false;
  }

  for (size_t i = 1; i < value.size(); ++i) {
    if (!std::isxdigit(static_cast<unsigned char>(value[i]))) {
      return false;
    }
  }

  return true;
}

std::string base64_encode(const std::string &in) {
  static const char table[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((in.size() + 2) / 3) * 4);

  int val = 0;
  int valb = -6;
  for (unsigned char c : in) {
    val = (val << 8) + c;
    valb += 8;
    while (valb >= 0) {
      out.push_back(table[(val >> valb) & 0x3F]);
      valb -= 6;
    }
  }
  if (valb > -6) {
    out.push_back(table[((val << 8) >> (valb + 8)) & 0x3F]);
  }
  while (out.size() % 4) {
    out.push_back('=');
  }
  return out;
}

void broadcast(const std::string &msg) {
  for (auto [id, client] : clients) {
    clients[id].ws->send(msg);
  }
}

void remember_message(const std::string &msg) {
  message_history.push_back(msg);
  if (message_history.size() > MAX_HISTORY) {
    message_history.pop_front();
  }
}

void expire_old_images_in_history() {
  for (auto &entry : message_history) {
    try {
      json evt = json::parse(entry);
      if (evt.value("event", "") != "photo") {
        continue;
      }
      if (!evt.contains("message_index") ||
          !evt["message_index"].is_number_integer()) {
        continue;
      }

      long long idx = evt["message_index"].get<long long>();
      if (chat_message_index - idx < IMAGE_EXPIRE_AFTER_MESSAGES) {
        continue;
      }

      json expired = {{"event", "msg"},
                      {"id", evt.value("id", "")},
                      {"username", evt.value("username", "unknown")},
                      {"color", evt.value("color", "white")},
                      {"timestamp", evt.value("timestamp", current_timestamp_ms())},
                      {"msg", "(expired image)"},
                      {"message_index", idx}};
      entry = expired.dump();
    } catch (...) {
    }
  }
}

void remember_chat_event(json evt) {
  chat_message_index++;
  evt["message_index"] = chat_message_index;
  remember_message(evt.dump());
  expire_old_images_in_history();
}

void broadcast_except(const std::string &msg, const int skip_id) {
  for (auto [id, client] : clients) {
    if (id == skip_id)
      continue;
    clients[id].ws->send(msg);
  }
}

int main() {
  httplib::Server svr;

  svr.WebSocket("/ws", [](const httplib::Request &req,
                          httplib::ws::WebSocket &ws) {
    std::string msg;
    int c_id;
    bool expecting_photo_binary = false;
    std::vector<std::string> history_snapshot;
    {
      std::lock_guard<std::mutex> l(clients_mutex);

      bool taken = true;
      while (taken) {
        c_id = rand();
        taken = false;
        for (auto [id, client] : clients) {
          if (id == c_id) {
            taken = true;
          }
        }
      }
      clients[c_id] = (Client{&ws, "", randomColor()});
    }

    while (true) {
      auto read_result = ws.read(msg);
      if (read_result == httplib::ws::Fail) {
        break;
      }

      if (read_result == httplib::ws::Binary) {
        if (!expecting_photo_binary) {
          continue;
        }
        expecting_photo_binary = false;

        if (msg.empty()) {
          continue;
        }

        std::string image_base64 = base64_encode(msg);
        std::string payload;
        {
          std::lock_guard<std::mutex> l(clients_mutex);
          json jmsg = {{"event", "photo"},
                       {"id", std::to_string(c_id)},
                       {"username", clients[c_id].username},
                       {"color", clients[c_id].color},
                       {"timestamp", current_timestamp_ms()},
                       {"mime", "image/jpeg"},
                       {"data", image_base64}};
          remember_chat_event(jmsg);
          payload = jmsg.dump();
        }
        broadcast(payload);
        continue;
      }

      std::cout << msg << std::endl;
      if (!msg.empty() && msg[0] == '&') // command
      {
        switch (msg[1]) {
        case 'u': {
          std::string uname = msg.substr(2);
          std::string requested_color;
          if (!uname.empty() && uname[0] == '{') {
            try {
              json login = json::parse(uname);
              uname = login.value("username", "");
              requested_color = login.value("color", "");
            } catch (...) {
              uname = "";
            }
          }
          std::string color;
          {
            std::lock_guard<std::mutex> l(clients_mutex);
            bool taken = false;
            for (auto &[id, client] : clients) {
              if (client.username == uname)
                taken = true;
            }
            if (taken) {
              json jmsg = {{"event", "uname-eval"}, {"result", "taken"}};
              ws.send(jmsg.dump());
              break;
            } else {
              json jmsg = {{"event", "uname-eval"}, {"result", "ok"}};
              ws.send(jmsg.dump());
              history_snapshot.assign(message_history.begin(),
                                      message_history.end());
              for (const auto &old_msg : history_snapshot) {
                ws.send(old_msg);
              }
            }
            clients[c_id].username = uname;
            if (is_valid_hex_color(requested_color)) {
              clients[c_id].color = requested_color;
            }
            color = clients[c_id].color;
          }
          json jmsg = {{"event", "userjoin"},
                       {"id", std::to_string(c_id)},
                       {"username", uname},
                       {"color", color},
                       {"timestamp", current_timestamp_ms()}};

          broadcast(jmsg.dump());

          remember_message((json){{"event", "msg"},
                                  {"id", std::to_string(c_id)},
                                  {"username", uname},
                                  {"color", clients[c_id].color},
                                  {"timestamp", current_timestamp_ms()},
                                  {"msg", " joined."}}
                               .dump());
          break;
        }
        case 'i': { // get users i̲n chat
          std::lock_guard<std::mutex> l(clients_mutex);
          json uja = json::object();
          for (auto [id, client] : clients) {
            if (id == c_id)
              continue;
            uja[std::to_string(id)] = {{"username", client.username},
                                       {"color", client.color}};
          }
          json jmsg = {{"event", "sendusers"}, {"users", uja}};
          clients[c_id].ws->send(jmsg.dump());
          break;
        }
        case 't': { // typing
          json jmsg = {{"event", "typing"}, {"id", std::to_string(c_id)}};
          broadcast(jmsg.dump());
          break;
        }
        case 's': { // stop typing
          json jmsg = {{"event", "stoptyping"}, {"id", std::to_string(c_id)}};
          broadcast(jmsg.dump());
          break;
        }
        case 'p': { // photo marker; next binary frame contains image bytes
          expecting_photo_binary = true;
          break;
        }
        }
      } else {
        std::string payload;
        {
          std::lock_guard<std::mutex> l(clients_mutex);
          json jmsg = {{"event", "msg"},
                       {"id", std::to_string(c_id)},
                       {"username", clients[c_id].username},
                       {"color", clients[c_id].color},
                       {"timestamp", current_timestamp_ms()},
                       {"msg", msg}};
          remember_chat_event(jmsg);
          payload = jmsg.dump();
        }
        broadcast(payload);
      }
    }

    // disconnect
    json jmsg = {{"event", "userleft"}, {"id", std::to_string(c_id)}};
    remember_message((json){{"event", "msg"},
                            {"id", std::to_string(c_id)},
                            {"username", clients[c_id].username},
                            {"color", clients[c_id].color},
                            {"timestamp", current_timestamp_ms()},
                            {"msg", " left."}}
                         .dump());
    {
      std::lock_guard<std::mutex> l(clients_mutex);
      clients.erase(c_id);
    }
    broadcast(jmsg.dump());
  });

  svr.set_mount_point("/", "./");

  
  std::cout << "Listening on " << "0.0.0.0:" << 8080 << std::endl;
  svr.listen("0.0.0.0", 8080);
}
