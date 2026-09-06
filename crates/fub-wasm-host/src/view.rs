//! Le dichiarazioni delle view, tradotte senza perdere interessi o parametri.
use crate::contract::{
    exports::fub::abi::view as w,
    fub::abi::{events as we, session as ws},
};
use crate::translate as tr;
use fub_abi::{event as e, session as s, traits as n};

pub(crate) fn to_instance(v: &n::ViewInstance) -> w::ViewInstance {
    w::ViewInstance {
        view: v.view.clone(),
        instance: v.instance.clone(),
        params: tr::to_json(&v.params),
    }
}
pub(crate) fn from_interests(v: w::ViewInterests) -> n::ViewInterests {
    n::ViewInterests {
        refresh: mask(v.refresh),
        follows: context(v.follows),
    }
}
fn context(v: ws::ContextMask) -> s::ContextMask {
    s::ContextMask(
        v.into_iter()
            .map(|k| match k {
                ws::ContextKind::Document => s::ContextKind::Document,
                ws::ContextKind::Selection => s::ContextKind::Selection,
                ws::ContextKind::Mode => s::ContextKind::Mode,
            })
            .collect(),
    )
}
fn mask(v: we::EventMask) -> e::EventMask {
    e::EventMask {
        kinds: v
            .kinds
            .into_iter()
            .map(|k| match k {
                we::EventKind::VaultOpened => e::EventKind::VaultOpened,
                we::EventKind::DocumentChanged => e::EventKind::DocumentChanged,
                we::EventKind::DocumentRemoved => e::EventKind::DocumentRemoved,
                we::EventKind::DocumentRenamed => e::EventKind::DocumentRenamed,
                we::EventKind::IndexUpdated => e::EventKind::IndexUpdated,
                we::EventKind::JobDone => e::EventKind::JobDone,
                we::EventKind::Overflow => e::EventKind::Overflow,
                we::EventKind::Custom => e::EventKind::Custom,
                we::EventKind::BatchEnded => e::EventKind::BatchEnded,
                we::EventKind::ViewInvalidated => e::EventKind::ViewInvalidated,
                we::EventKind::VaultClosed => e::EventKind::VaultClosed,
                we::EventKind::JobStarted => e::EventKind::JobStarted,
                we::EventKind::JobProgress => e::EventKind::JobProgress,
                we::EventKind::SettingChanged => e::EventKind::SettingChanged,
                we::EventKind::EntryChanged => e::EventKind::EntryChanged,
                we::EventKind::EntryRemoved => e::EventKind::EntryRemoved,
                we::EventKind::EntryRenamed => e::EventKind::EntryRenamed,
                we::EventKind::Trouble => e::EventKind::Trouble,
                we::EventKind::TimerFired => e::EventKind::TimerFired,
            })
            .collect(),
        topics: v.topics,
        subjects: v
            .subjects
            .into_iter()
            .map(|v| match v {
                we::Subject::Document(id) => e::Subject::document(id.id),
                we::Subject::Folder(path) => e::Subject::folder(path.path),
            })
            .collect(),
        changes: v
            .changes
            .into_iter()
            .map(|v| match v {
                we::DocChange::Body => e::DocChange::Body,
                we::DocChange::Frontmatter => e::DocChange::Frontmatter,
                we::DocChange::Tags => e::DocChange::Tags,
                we::DocChange::Links => e::DocChange::Links,
                we::DocChange::Outline => e::DocChange::Outline,
                we::DocChange::Anchors => e::DocChange::Anchors,
            })
            .collect(),
    }
}
pub(crate) fn from_spec(v: w::ViewSpec) -> n::ViewSpec {
    n::ViewSpec {
        id: v.id,
        title: tr::from_text(v.title),
        surface: match v.surface {
            w::ViewSurface::LeftSidebar => n::ViewSurface::LeftSidebar,
            w::ViewSurface::RightSidebar => n::ViewSurface::RightSidebar,
            w::ViewSurface::Bottom => n::ViewSurface::Bottom,
            w::ViewSurface::Main => n::ViewSurface::Main,
            w::ViewSurface::Modal => n::ViewSurface::Modal,
            w::ViewSurface::StatusBar => n::ViewSurface::StatusBar,
            w::ViewSurface::Ribbon => n::ViewSurface::Ribbon,
            w::ViewSurface::Menu => n::ViewSurface::Menu,
            w::ViewSurface::ContextMenu => n::ViewSurface::ContextMenu,
            w::ViewSurface::SettingsTab => n::ViewSurface::SettingsTab,
        },
        refresh: mask(v.refresh),
        follows: context(v.follows),
        params: v.params.into_iter().map(tr::from_param_spec).collect(),
        icon: v.icon,
        order: v.order,
        open_by_default: v.open_by_default,
        preferred_size: v.preferred_size,
        closable: v.closable,
    }
}
