# C6 Review/Production résumé scanner — the Render cron image (Atlas-native, 2026-11-18).
# Build context: the repository root. Render: Runtime Docker, Dockerfile path ops/scanner/Dockerfile,
# command left empty (the entrypoint runs one batch), plan with >= 4 GB RAM (clamd holds the signatures).
# Pinned by digest (resolved by CI run 44477140778, 2026-11-19).
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
RUN apt-get update \
 && apt-get install -y --no-install-recommends clamav clamav-daemon clamav-freshclam ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY ops/scanner/clamd.conf /etc/clamav/clamd.conf
# EnableVersionCommand exists only in builds that can disable VERSION (Ubuntu's); Debian's clamd rejects the
# unknown option and always answers VERSION. Keep the line only where the binary knows it; the self-test
# proves VERSION answers either way.
RUN grep -aq EnableVersionCommand /usr/sbin/clamd || sed -i '/^EnableVersionCommand /d' /etc/clamav/clamd.conf \
 && clamconf -n >/dev/null
# Official signatures baked in at build; each run refreshes them incrementally (run.sh).
RUN freshclam --stdout --foreground || [ $? -eq 1 ]
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY backend/src ./src
COPY backend/scripts/resume-scan.mjs ./scripts/resume-scan.mjs
COPY ops/scanner/run.sh ops/scanner/selftest.mjs /app/ops/scanner/
RUN chown -R clamav:clamav /var/lib/clamav && chmod 0755 /app/ops/scanner/run.sh
ENTRYPOINT ["/app/ops/scanner/run.sh"]
