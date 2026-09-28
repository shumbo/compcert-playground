# syntax=docker/dockerfile:1
# Builds CompCert's extracted OCaml sources, then compiles a playground
# driver to WebAssembly with wasm_of_ocaml.

ARG COMPCERT_VERSION=v3.18

FROM ocaml/opam:debian-12-ocaml-5.3 AS toolchain
# wasm_of_ocaml needs binaryen >= 119; Debian's package is older, so build
# binaryen-bin from opam first so that it shadows the system one on PATH.
RUN sudo apt-get update -qq && opam update -q \
 && opam install -y -j"$(nproc)" binaryen-bin
RUN opam install -y -j"$(nproc)" \
      rocq-prover.9.0.0 menhir.20260209 \
      js_of_ocaml js_of_ocaml-ppx wasm_of_ocaml-compiler.6.3.2 \
 && opam clean -a -c -s --logs

FROM toolchain AS compcert
ARG COMPCERT_VERSION
WORKDIR /home/opam
RUN git clone -q --depth 1 -b ${COMPCERT_VERSION} https://github.com/AbsInt/CompCert.git compcert
WORKDIR /home/opam/compcert
RUN opam exec -- ./configure -clightgen x86_64-linux \
 && opam exec -- make -j"$(nproc)" depend \
 && opam exec -- make -j"$(nproc)" extraction \
 && opam exec -- make -j"$(nproc)" -f Makefile.extr cparser/pre_parser_messages.ml

FROM compcert AS playground
COPY --chown=opam playground /home/opam/playground
RUN opam exec -- sh /home/opam/playground/build.sh /home/opam/compcert /home/opam/out

# C preprocessor (mcpp) compiled to wasm, plus the headers it serves:
# CompCert's own runtime/include and musl's libc headers for x86_64.
FROM emscripten/emsdk:latest AS prepro
ARG MCPP_VERSION=2.7.2
ARG MUSL_VERSION=1.2.5
WORKDIR /build
RUN curl -fsSL -o mcpp.tar.gz \
      https://downloads.sourceforge.net/project/mcpp/mcpp/V.${MCPP_VERSION}/mcpp-${MCPP_VERSION}.tar.gz \
 && tar xzf mcpp.tar.gz \
 && curl -fsSL -o musl.tar.gz https://musl.libc.org/releases/musl-${MUSL_VERSION}.tar.gz \
 && tar xzf musl.tar.gz
RUN cd mcpp-${MCPP_VERSION} \
 && emconfigure ./configure --build=x86_64-pc-linux-gnu --host=x86_64-pc-linux-gnu \
      --disable-shared \
      CFLAGS="-O2 -Wno-implicit-function-declaration -Wno-int-conversion -Wno-incompatible-pointer-types" \
 && cd src && emmake make -j"$(nproc)" LDFLAGS="-sMODULARIZE=1 -sEXPORT_ES6=1 \
      -sEXPORT_NAME=createMcpp -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 \
      -sENVIRONMENT=web,worker,node -sEXPORTED_RUNTIME_METHODS=FS,callMain" \
 && mkdir -p /out && cp mcpp /out/mcpp.mjs && cp mcpp.wasm /out/
RUN cd musl-${MUSL_VERSION} \
 && make ARCH=x86_64 prefix=/headers/libc includedir=/headers/libc install-headers
ARG COMPCERT_VERSION
RUN git clone -q --depth 1 -b ${COMPCERT_VERSION} https://github.com/AbsInt/CompCert.git cc \
 && cp -r cc/runtime/include /headers/compcert && rm -rf cc
COPY playground/bundle_headers.py /build/
RUN python3 bundle_headers.py /headers /out/headers.json

FROM scratch AS artifacts
COPY --from=prepro /out/ /
COPY --from=playground /home/opam/out/ /
