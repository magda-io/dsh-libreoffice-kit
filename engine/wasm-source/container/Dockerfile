# MAGDA builder for the Node WASM engine. The engine output is architecture
# neutral; the builder runs natively on linux/arm64 or linux/amd64.
# Core 26.8 requires GCC 13 or newer for its build-platform tools.
FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2

ARG NODE_VERSION=22.23.5
ARG NODE_SHA256_ARM64=2babb9eb5264860d540849f4b064a6fbdebcdc323657d9d382ce23d313fd5e09
ARG NODE_SHA256_X64=cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8

# Core's cross build compiles its build-platform tools from source and needs
# only a minimal host toolset; Emscripten supplies the target toolchain.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    autoconf automake bison bzip2 ca-certificates curl file flex g++ gcc gettext \
    git gperf libc6-dev libtool make ninja-build patch pkg-config python3 \
    rsync unzip xsltproc xz-utils zip \
  && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
  case "$(dpkg --print-architecture)" in \
    arm64) arch=arm64; sum="$NODE_SHA256_ARM64" ;; \
    amd64) arch=x64; sum="$NODE_SHA256_X64" ;; \
    *) echo "unsupported builder architecture" >&2; exit 1 ;; \
  esac; \
  curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz"; \
  echo "${sum}  /tmp/node.tar.xz" | sha256sum -c -; \
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner; \
  rm /tmp/node.tar.xz; \
  node --version

# Core refuses to build as root. The mounted source repository belongs to
# another user, so Git must accept it as a clone origin.
RUN useradd --create-home --uid 1000 builder \
  && mkdir -p /build/libreoffice-kit && chown builder: /build/libreoffice-kit
USER builder
RUN git config --global --add safe.directory '*'

# Same public build paths as the published engine receipts.
WORKDIR /build/libreoffice-kit
COPY build.sh /usr/local/bin/build-libreoffice-kit-wasm
ENTRYPOINT ["/usr/local/bin/build-libreoffice-kit-wasm"]
