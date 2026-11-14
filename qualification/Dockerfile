# Differential qualification host for LibreOffice Kit installations.
FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2
ARG NODE_VERSION=22.23.5
ARG NODE_SHA256_ARM64=2babb9eb5264860d540849f4b064a6fbdebcdc323657d9d382ce23d313fd5e09
ARG NODE_SHA256_X64=cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8
# Fonts match MAGDA's Agent Runtime image (Liberation, Carlito, Caladea, DejaVu) plus Noto CJK.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils poppler-utils python3 python3-openpyxl python3-docx python3-pil python3-numpy \
    fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*
RUN set -eu; case "$(dpkg --print-architecture)" in arm64) a=arm64; s="$NODE_SHA256_ARM64";; amd64) a=x64; s="$NODE_SHA256_X64";; esac; \
  curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${a}.tar.xz"; \
  echo "${s}  /tmp/node.tar.xz" | sha256sum -c -; tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner; rm /tmp/node.tar.xz
RUN useradd --create-home --uid 1000 runner
USER runner
WORKDIR /work
