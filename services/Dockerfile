# Builds both Rust services. Context: repo root (needs sdk/ for Poseidon2 constants + vectors).
FROM rust:1.99-bookworm AS build
WORKDIR /src
COPY sdk/src/crypto/poseidon2-bn254.json sdk/src/crypto/poseidon2-bn254.json
COPY sdk/test/vectors.json sdk/test/vectors.json
COPY services services
RUN cd services && cargo build --release --bins

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/services/target/release/vatanta-relayer /usr/local/bin/
COPY --from=build /src/services/target/release/vatanta-indexer /usr/local/bin/
ENV RUST_LOG=info
