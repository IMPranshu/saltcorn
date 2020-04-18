const Form = require("saltcorn-data/models/form");
const Field = require("saltcorn-data/models/field");
const Table = require("saltcorn-data/models/table");
const FieldRepeat = require("saltcorn-data/models/fieldrepeat");
const { mkTable } = require("saltcorn-markup");
const Workflow = require("saltcorn-data/models/workflow");
const { get_viewable_fields } = require("./viewable_fields");

const { div, h4, table, tbody, tr, td, text } = require("saltcorn-markup/tags");
const {
  field_picker_fields,
  picked_fields_to_query
} = require("saltcorn-data/plugin-helper");

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "showfields",
        form: async context => {
          const table = await Table.findOne({ id: context.table_id });
          const field_picker_repeat = await field_picker_fields({ table });
          return new Form({
            blurb:
              "Finalise your show view by specifying the fields in the table",
            fields: [
              new FieldRepeat({
                name: "columns",
                fields: field_picker_repeat
              }),
              {
                name: "label_style",
                label: "Label style",
                type: "String",
                required: true,
                attributes: {
                  options: "Besides, Above, None"
                }
              }
            ]
          });
        }
      }
    ]
  });
const get_state_fields = () => [
  {
    name: "id",
    type: "Integer",
    required: true
  }
];

const run = async (table_id, viewname, { columns, label_style }, { id }) => {
  if (typeof id === "undefined") return "No record selected";

  const tbl = await Table.findOne({ id: table_id });
  const fields = await Field.find({ table_id: tbl.id });
  const { joinFields, aggregations } = picked_fields_to_query(columns);
  const [row] = await tbl.getJoinedRows({
    where: { id },
    joinFields,
    aggregations,
    limit: 1
  });
  const tfields = get_viewable_fields(viewname, tbl, fields, columns, true);

  if (label_style === "Besides") {
    const trows = tfields.map(f =>
      tr(
        td(text(f.label)),
        td(typeof f.key === "string" ? text(row[f.key]) : f.key(row))
      )
    );
    return table(tbody(trows));
  } else if (label_style === "Above") {
    const trows = tfields.map(f =>
      div(
        div(text(f.label)),
        div(typeof f.key === "string" ? text(row[f.key]) : f.key(row))
      )
    );
    return div(trows);
  } else {
    const trows = tfields.map(f =>
      div(typeof f.key === "string" ? text(row[f.key]) : f.key(row))
    );
    return div(trows);
  }
};

module.exports = {
  name: "Show",
  get_state_fields,
  configuration_workflow,
  run,
  display_state_form: false
};
