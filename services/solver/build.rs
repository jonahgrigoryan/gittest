fn main() {
    println!("cargo:rerun-if-changed=../../proto/solver.proto");
    tonic_build::configure()
        .build_server(true)
        .compile(&["../../proto/solver.proto"], &["../../proto"])
        .unwrap();
}
