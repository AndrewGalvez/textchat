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

    while (ws.read(msg)) {
      std::cout << msg << std::endl;
      if (msg[0] == '&') // command
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
        };
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
          payload = jmsg.dump();
          remember_message(payload);
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

  svr.listen("0.0.0.0", 8080);
}
