simple chatroom built with a c++ server and a couple libraries

note: server runs on my home pc and may shut down if my power goes out. please notify me on Discord: waffledogz, or in Github Issues in this repo

build:
 - Windows: `.\make.exe`
 - Linux: `make`

pptx uploads:
 - `.pptx` files are converted to `.pdf` before being sent into chat
 - On Linux, conversion uses LibreOffice `soffice` from `PATH`.
 - On Windows, conversion usesPowerPoint thing
 - If the required converter is missing for the current platform, the server prints a startup warning and `.pptx` conversion requests will fail.

credit:
 - https://github.com/yhirose/cpp-httplib (server)
 - https://github.com/nlohmann/json (server-side json)
 - https://favicon.io (favicon)
