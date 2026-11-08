#!/bin/sh
set -eu
test -s /run/secrets/vnc-password
export DISPLAY=:99
Xvfb :99 -screen 0 1024x768x24 -nolisten tcp &
for i in 1 2 3 4 5 6 7 8 9 10; do
  if xset q >/dev/null 2>&1; then break; fi
  sleep 1
done
xset q >/dev/null
xsetroot -solid '#2563a6'
xterm -geometry 75x18+60+55 -bg '#f8f8f8' -fg '#202020' \
  -hold -e sh -c 'printf "NodeDesk disposable VNC test desktop\n"' &
x11vnc -display :99 -rfbport 5900 -listen 127.0.0.1 \
  -passwdfile /run/secrets/vnc-password -forever -shared -noxdamage &
exec websockify 0.0.0.0:6080 127.0.0.1:5900
