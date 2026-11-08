FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc xterm x11-xserver-utils && \
    rm -rf /var/lib/apt/lists/* && \
    pip install --no-cache-dir websockify==0.12.0

COPY start.sh /usr/local/bin/start-vnc-lab
RUN chmod 0755 /usr/local/bin/start-vnc-lab
CMD ["/usr/local/bin/start-vnc-lab"]
