fn main() {
    println!("cargo:rerun-if-changed=../../proto/solver.proto");

    // Use a vendored protoc binary so CI machines do not need system-level protoc installed.
    let protoc_path = protoc_bin_vendored::protoc_bin_path()
        .expect("protoc binary should be available via protoc-bin-vendored");

    tonic_build::configure()
        .protoc_path(protoc_path)
        .build_server(true)
        .compile(&["../../proto/solver.proto"], &["../../proto"])
        .unwrap();
}
