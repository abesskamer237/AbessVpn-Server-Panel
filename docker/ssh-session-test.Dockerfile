FROM node:22-bookworm-slim AS node
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server openssh-client iproute2 && rm -rf /var/lib/apt/lists/*
WORKDIR /tests
COPY scripts/ssh_session_identity.py scripts/ssh-session-guard.py scripts/ssh-ws-passive-traffic.py scripts/test-ssh-session-live.py ./
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY scripts/ssh-raw-meter.mjs scripts/ssh-ws-quota.mjs scripts/ssh-pam-admission.py scripts/test-ssh-raw-live.py ./
ENV ABESS_ISOLATED_SSH_TEST=yes
CMD ["python3", "test-ssh-session-live.py"]
