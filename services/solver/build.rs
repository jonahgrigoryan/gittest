fn main() {
    println!("cargo:rerun-if-changed=../../proto/solver.proto");

    // Use a vendored protoc binary so CI machines do not need system-level protoc installed.
    let protoc_path = protoc_bin_vendored::protoc_bin_path()
        .expect("protoc binary should be available via protoc-bin-vendored");

    // tonic-build 0.11 does not expose a builder method to override the protoc
    // binary, but it respects the PROTOC env var. Point it at the vendored binary.
    std::env::set_var("PROTOC", protoc_path);

    tonic_build::configure()
        .build_server(true)
        .compile(&["../../proto/solver.proto"], &["../../proto"])
        .unwrap();
}
