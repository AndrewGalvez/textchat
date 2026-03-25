#ifndef WINVER
#define WINVER 0x0A00
#endif

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif

#include "color.h"
#include "httplib.h"
#include "json.hpp"
#include <cstdlib>
#include <iostream>
#include <map>
#include <mutex>
#include <string>

using nlohmann::json;

struct Client {
  httplib::ws::WebSocket *ws;
  std::string username;
  std::string color;
};

std::map<int, Client> clients;
std::mutex clients_mutex;

void broadcast(const std::string &msg) {
  for (auto [id, client] : clients) {
    clients[id].ws->send(msg);
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

  svr.WebSocket(
      "/ws", [](const httplib::Request &req, httplib::ws::WebSocket &ws) {
        std::string msg;
        int c_id;
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
              std::lock_guard<std::mutex> l(clients_mutex);
              std::string uname = msg.substr(2);
              clients[c_id].username = uname;
              json jmsg = {{"event", "userjoin"},
                           {"id", std::to_string(c_id)},
                           {"username", uname},
                           {"color", clients[c_id].color}};

              broadcast(jmsg.dump());
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
            }
          } else {
            json jmsg = {
                {"event", "msg"}, {"id", std::to_string(c_id)}, {"msg", msg}};
            std::lock_guard<std::mutex> l(clients_mutex);
            broadcast(jmsg.dump());
          }
        }

        // disconnect
        json jmsg = {{"event", "userleft"}, {"id", std::to_string(c_id)}};
        {
          std::lock_guard<std::mutex> l(clients_mutex);
          clients.erase(c_id);
        }
        broadcast(jmsg.dump());
      });

  svr.set_mount_point("/", "./");

  svr.listen("0.0.0.0", 8080);
}
