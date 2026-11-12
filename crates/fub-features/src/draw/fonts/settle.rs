//! Il GPOS e il GSUB di un'istanza: le variazioni sommate nel punto scelto e
//! le varianti di funzione risolte.

use skrifa::raw::tables::variations::{DeltaSetIndex, ItemVariationStore};
use skrifa::raw::types::F2Dot14;
use skrifa::raw::{FontRef, TableProvider};
use write_fonts::from_obj::ToOwnedTable;
use write_fonts::tables::gpos::{
    AnchorTable, ExtensionSubtable, Gpos, PairPos, PositionLookup, SinglePos, ValueFormat,
    ValueRecord,
};
use write_fonts::tables::gsub::Gsub;
use write_fonts::tables::layout::{
    Condition, DeviceOrVariationIndex, FeatureList, FeatureVariations,
};
use write_fonts::{dump_table, NullableOffsetMarker};

use super::instance::clamp_i16;

// --- il GPOS e il GSUB in un punto ------------------------------------------

/// Il `GPOS` con le variazioni della crenatura e degli attacchi sommate ai
/// valori del punto `coords`, e le `FeatureVariations` risolte. `None` se non
/// c'è niente da cambiare, o se il `GPOS` riscritto non si scrive: allora resta
/// quello di serie, con la crenatura del punto di serie.
pub(super) fn settle_gpos(
    font: &FontRef,
    store: Option<&ItemVariationStore>,
    coords: &[F2Dot14],
) -> Option<Vec<u8>> {
    let read = font.gpos().ok()?;
    let has_variations = read.feature_variations().is_some();
    if store.is_none() && !has_variations {
        return None;
    }
    let mut gpos: Gpos = read.to_owned_table();
    if let Some(store) = store {
        let delta = |device: &DeviceOrVariationIndex| -> Option<i32> {
            let DeviceOrVariationIndex::VariationIndex(index) = device else {
                return None;
            };
            let index = DeltaSetIndex {
                outer: index.delta_set_outer_index,
                inner: index.delta_set_inner_index,
            };
            Some(store.compute_delta(index, coords).unwrap_or(0))
        };
        for lookup in gpos.lookup_list.lookups.iter_mut() {
            settle_lookup(lookup, &delta);
        }
    }
    let features = std::mem::take(&mut gpos.feature_variations).into_inner();
    settle_features(&mut gpos.feature_list, features, coords);
    dump_table(&gpos).ok()
}

/// Il `GSUB` con le `FeatureVariations` risolte nel punto `coords`, o `None`
/// se non ne ha.
pub(super) fn settle_gsub(font: &FontRef, coords: &[F2Dot14]) -> Option<Vec<u8>> {
    let read = font.gsub().ok()?;
    read.feature_variations()?.ok()?;
    let mut gsub: Gsub = read.to_owned_table();
    let features = std::mem::take(&mut gsub.feature_variations).into_inner();
    settle_features(&mut gsub.feature_list, features, coords);
    dump_table(&gsub).ok()
}

/// Sostituisce le funzioni del primo `FeatureVariationRecord` le cui
/// condizioni valgono nel punto `coords`, come fa il motore di composizione.
fn settle_features(
    list: &mut FeatureList,
    variations: Option<FeatureVariations>,
    coords: &[F2Dot14],
) {
    let Some(variations) = variations else {
        return;
    };
    for record in variations.feature_variation_records {
        let holds = record
            .condition_set
            .as_ref()
            .is_none_or(|set| set.conditions.iter().all(|each| holds(each, coords)));
        if !holds {
            continue;
        }
        if let Some(substitution) = record.feature_table_substitution.into_inner() {
            for each in substitution.substitutions {
                if let Some(feature) = list
                    .feature_records
                    .get_mut(usize::from(each.feature_index))
                {
                    feature.feature = each.alternate_feature.into_inner().into();
                }
            }
        }
        return;
    }
}

/// Se una condizione vale nel punto `coords`. Una condizione su un valore che
/// varia (formato 2) non si sa calcolare qui, e non vale.
fn holds(condition: &Condition, coords: &[F2Dot14]) -> bool {
    match condition {
        Condition::Format1AxisRange(range) => {
            let value = coords
                .get(usize::from(range.axis_index))
                .copied()
                .unwrap_or_default();
            range.filter_range_min_value <= value && value <= range.filter_range_max_value
        }
        Condition::Format2VariableValue(_) => false,
        Condition::Format3And(all) => all.conditions.iter().all(|each| holds(each, coords)),
        Condition::Format4Or(any) => any.conditions.iter().any(|each| holds(each, coords)),
        Condition::Format5Negate(not) => !holds(&not.condition, coords),
    }
}

/// Somma le variazioni ai valori di una ricerca del `GPOS`.
fn settle_lookup(
    lookup: &mut PositionLookup,
    delta: &dyn Fn(&DeviceOrVariationIndex) -> Option<i32>,
) {
    match lookup {
        PositionLookup::Single(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_single(table, delta);
            }
        }
        PositionLookup::Pair(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_pair(table, delta);
            }
        }
        PositionLookup::Cursive(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_cursive(table, delta);
            }
        }
        PositionLookup::MarkToBase(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_mark_base(table, delta);
            }
        }
        PositionLookup::MarkToLig(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_mark_lig(table, delta);
            }
        }
        PositionLookup::MarkToMark(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_mark_mark(table, delta);
            }
        }
        PositionLookup::Contextual(_) | PositionLookup::ChainContextual(_) => {}
        PositionLookup::Extension(lookup) => {
            for table in lookup.subtables.iter_mut() {
                match &mut **table {
                    ExtensionSubtable::Single(ext) => settle_single(&mut ext.extension, delta),
                    ExtensionSubtable::Pair(ext) => settle_pair(&mut ext.extension, delta),
                    ExtensionSubtable::Cursive(ext) => settle_cursive(&mut ext.extension, delta),
                    ExtensionSubtable::MarkToBase(ext) => {
                        settle_mark_base(&mut ext.extension, delta)
                    }
                    ExtensionSubtable::MarkToLig(ext) => settle_mark_lig(&mut ext.extension, delta),
                    ExtensionSubtable::MarkToMark(ext) => {
                        settle_mark_mark(&mut ext.extension, delta)
                    }
                    ExtensionSubtable::Contextual(_) | ExtensionSubtable::ChainContextual(_) => {}
                }
            }
        }
    }
}

type Delta<'d> = &'d dyn Fn(&DeviceOrVariationIndex) -> Option<i32>;

fn settle_single(table: &mut SinglePos, delta: Delta) {
    match table {
        SinglePos::Format1(table) => settle_value(&mut table.value_record, delta),
        SinglePos::Format2(table) => {
            for record in table.value_records.iter_mut() {
                settle_value(record, delta);
            }
        }
    }
}

fn settle_pair(table: &mut PairPos, delta: Delta) {
    match table {
        PairPos::Format1(table) => {
            for set in table.pair_sets.iter_mut() {
                for record in set.pair_value_records.iter_mut() {
                    settle_value(&mut record.value_record1, delta);
                    settle_value(&mut record.value_record2, delta);
                }
            }
        }
        PairPos::Format2(table) => {
            for first in table.class1_records.iter_mut() {
                for record in first.class2_records.iter_mut() {
                    settle_value(&mut record.value_record1, delta);
                    settle_value(&mut record.value_record2, delta);
                }
            }
        }
    }
}

fn settle_cursive(table: &mut write_fonts::tables::gpos::CursivePosFormat1, delta: Delta) {
    for record in table.entry_exit_record.iter_mut() {
        settle_anchor(&mut record.entry_anchor, delta);
        settle_anchor(&mut record.exit_anchor, delta);
    }
}

fn settle_marks(marks: &mut write_fonts::tables::gpos::MarkArray, delta: Delta) {
    for record in marks.mark_records.iter_mut() {
        settle_anchor_table(&mut record.mark_anchor, delta);
    }
}

fn settle_mark_base(table: &mut write_fonts::tables::gpos::MarkBasePosFormat1, delta: Delta) {
    settle_marks(&mut table.mark_array, delta);
    for record in table.base_array.base_records.iter_mut() {
        for anchor in record.base_anchors.iter_mut() {
            settle_anchor(anchor, delta);
        }
    }
}

fn settle_mark_lig(table: &mut write_fonts::tables::gpos::MarkLigPosFormat1, delta: Delta) {
    settle_marks(&mut table.mark_array, delta);
    for attach in table.ligature_array.ligature_attaches.iter_mut() {
        for component in attach.component_records.iter_mut() {
            for anchor in component.ligature_anchors.iter_mut() {
                settle_anchor(anchor, delta);
            }
        }
    }
}

fn settle_mark_mark(table: &mut write_fonts::tables::gpos::MarkMarkPosFormat1, delta: Delta) {
    settle_marks(&mut table.mark1_array, delta);
    for record in table.mark2_array.mark2_records.iter_mut() {
        for anchor in record.mark2_anchors.iter_mut() {
            settle_anchor(anchor, delta);
        }
    }
}

fn settle_anchor(anchor: &mut NullableOffsetMarker<AnchorTable>, delta: Delta) {
    if let Some(anchor) = anchor.as_mut() {
        settle_anchor_table(anchor, delta);
    }
}

/// Un attacco con le variazioni sommate alle coordinate. Le tabelle dei pixel
/// (`Device`) restano.
fn settle_anchor_table(anchor: &mut AnchorTable, delta: Delta) {
    let AnchorTable::Format3(anchor) = anchor else {
        return;
    };
    for (value, device) in [
        (&mut anchor.x_coordinate, &mut anchor.x_device),
        (&mut anchor.y_coordinate, &mut anchor.y_device),
    ] {
        if let Some(shift) = device.as_ref().and_then(delta) {
            *value = clamp_i16(i32::from(*value) + shift);
            device.clear();
        }
    }
}

/// Un valore del `GPOS` con le variazioni sommate. Il formato resta quello di
/// tutta la sottotabella, che i valori devono condividere, con in più il campo
/// di ogni variazione: dove c'era soltanto la variazione ora c'è il numero.
fn settle_value(record: &mut ValueRecord, delta: Delta) {
    let mut format = record.format();
    for (value, device, value_bit, device_bit) in [
        (
            &mut record.x_placement,
            &mut record.x_placement_device,
            ValueFormat::X_PLACEMENT,
            ValueFormat::X_PLACEMENT_DEVICE,
        ),
        (
            &mut record.y_placement,
            &mut record.y_placement_device,
            ValueFormat::Y_PLACEMENT,
            ValueFormat::Y_PLACEMENT_DEVICE,
        ),
        (
            &mut record.x_advance,
            &mut record.x_advance_device,
            ValueFormat::X_ADVANCE,
            ValueFormat::X_ADVANCE_DEVICE,
        ),
        (
            &mut record.y_advance,
            &mut record.y_advance_device,
            ValueFormat::Y_ADVANCE,
            ValueFormat::Y_ADVANCE_DEVICE,
        ),
    ] {
        if !format.contains(device_bit) {
            continue;
        }
        format |= value_bit;
        let shift = device.as_ref().and_then(delta);
        if let Some(shift) = shift {
            *value = Some(clamp_i16(i32::from(value.unwrap_or(0)) + shift));
            device.clear();
        } else if value.is_none() {
            *value = Some(0);
        }
    }
    record.set_explicit_value_format(format);
}
