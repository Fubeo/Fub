use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 path");
    (dir, root)
}

#[test]
fn desktop_mount_registers_fubsheet_without_changing_markdown_default() {
    let (_dir, root) = vault();
    let mut mounted = fub_host::mount::mount(
        &root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("mount succeeds");

    assert_eq!(
        mounted
            .workspace
            .format_of(&DocId::new("Conti.fubsheet"))
            .expect("sheet provider is registered")
            .descriptor
            .id,
        "fubsheet"
    );
    assert_eq!(
        mounted
            .workspace
            .format_of(&DocId::new("Nota.md"))
            .expect("markdown remains registered")
            .descriptor
            .id,
        "markdown"
    );
    assert_eq!(
        mounted
            .workspace
            .create_notes(None)
            .expect("default note remains available"),
        DocId::new("Senza titolo.md")
    );
}
