import Node from "./nodes/node";
import type { NodeType } from "./nodes/node";
import {
  AbstractView as View,
  instanceOfView,
} from "@saltcorn/types/model-abstracts/abstract_view";
import { AbstractPage as Page } from "@saltcorn/types/model-abstracts/abstract_page";
import { AbstractTable as Table } from "@saltcorn/types/model-abstracts/abstract_table";
import layout from "../models/layout";
const { traverseSync } = layout;
const {
  parse_view_select,
} = require("../base-plugin/viewtemplates/viewable_fields");
import type { ConnectedObjects } from "@saltcorn/types/base_types";
import Trigger from "../models/trigger";
import { TableNode } from "./nodes/table_node";
import { TriggerNode } from "./nodes/trigger_node";
import { ViewNode } from "./nodes/view_node";
import { PageNode } from "./nodes/page_node";

// TODO this is a copy from 'common_list.js'
const setTableRefs = async (views: any) => {
  const tables = await require("../models/table").find();
  const getTable = (tid: any) => tables.find((t: any) => t.id === tid).name;

  views.forEach((v: any) => {
    if (v.table_id) v.table = getTable(v.table_id);
    else if (v.exttable_name) v.table = v.exttable_name;
    else v.table = "";
  });
  return views;
};

const setRefs = async (connected: ConnectedObjects) => {
  if (connected.linkedViews) await setTableRefs(connected.linkedViews);
  if (connected.embeddedViews) await setTableRefs(connected.embeddedViews);
};

export type ExtractOpts = {
  entryPages?: Array<Page>;
  showViews: boolean;
  viewFilterIds?: Set<number>;
  showPages: boolean;
  pageFilterIds?: Set<number>;
  showTables: boolean;
  tableFilterIds?: Set<number>;
  showTrigger: boolean;
  triggerFilterIds?: Set<number>;
};

/**
 * builds object trees for 'views/pages' with branches for all possible paths
 * @param opts filter and entry pages options.
 * If 'entryPages' is an array, those will be the start nodes of the first graphs
 * @returns root nodes
 */
export async function buildObjectTrees(
  opts: ExtractOpts
): Promise<Array<Node>> {
  const result = new Array<Node>();
  const helper = new ExtractHelper(opts);
  if (opts.showPages) {
    const entryPages = opts.entryPages ? opts.entryPages : new Array<any>();
    const entryPageTrees = await buildTree("page", entryPages, helper);
    const allPages = await require("../models/page").find();
    const pageTrees = await buildTree("page", allPages, helper);
    result.push(...entryPageTrees, ...pageTrees);
  }
  if (opts.showViews) {
    const allViews = await require("../models/view").find();
    await setTableRefs(allViews);
    const viewTrees = await buildTree("view", allViews, helper);
    result.push(...viewTrees);
  }
  return result;
}

async function buildTree(
  type: NodeType,
  objects: Array<Page | View>,
  helper: ExtractHelper
) {
  const result = new Array<Node>();
  for (const object of objects) {
    let node;
    let includeObject;
    if (instanceOfView(object)) {
      node = new ViewNode(object, await object.getTags());
      includeObject = includeView(object, helper.opts);
    } else {
      node = new PageNode(object, await object.getTags());
      includeObject = includePage(object, helper.opts);
    }
    if (includeObject && !helper.cyIds.has(node.cyId)) {
      helper.cyIds.add(node.cyId);
      const connected = await object.connected_objects();
      await setRefs(connected);
      await helper.handleNodeConnections(node, connected);
      result.push(node);
    }
  }
  return result;
}

/**
 * extracts all 'views/pages' aligned in the layout
 * @param layout view or page layout
 * @returns all found objects
 */
export function extractFromLayout(layout: any): ConnectedObjects {
  const embeddedViews = new Array<View>();
  const linkedPages = new Array<Page>();
  const linkedViews = new Array<View>();
  const _View = require("../models/view");
  const _Page = require("../models/page");
  traverseSync(layout, {
    view(segment: any) {
      const select = parse_view_select(segment.view);
      const view = _View.findOne({ name: select.viewname });
      if (view) embeddedViews.push(view);
    },
    view_link(segment: any) {
      const select = parse_view_select(segment.view);
      const view = _View.findOne({ name: select.viewname });
      if (view) linkedViews.push(view);
    },
    link(segment: any) {
      if (segment.link_src === "View") {
        const parts = segment.url.split("/");
        const viewName = parts[parts.length - 1];
        const view = _View.findOne({ name: viewName });
        if (view) linkedViews.push(view!);
      } else if (segment.link_src === "Page") {
        const parts = segment.url.split("/");
        const pagename = parts[parts.length - 1];
        const page = _Page.findOne({ name: pagename });
        if (page) linkedPages.push(page!);
      }
    },
  });

  return {
    embeddedViews,
    linkedViews,
    linkedPages,
  };
}

/**
 * extracts all views from 'columns'
 * @param columns columns from a view configuration
 * @returns all found objects
 */
export function extractFromColumns(columns: any[]): ConnectedObjects {
  const linkedViews = new Array<View>();
  const _View = require("../models/view");
  for (const column of columns) {
    if (column.type === "ViewLink") {
      const select = parse_view_select(column.view);
      const view = _View.findOne({ name: select.viewname });
      if (view) linkedViews.push(view);
    }
  }
  // currently only used for list
  // TODO embedded views and linked pages for other templates
  return { linkedViews };
}

/**
 * extracts one view that is used to create new entries
 * e.g. an embedded edit under the table of a list
 * @param configuration config of the view
 * @returns
 */
export function extractViewToCreate(
  configuration: any
): ConnectedObjects | null {
  const { view_to_create, create_view_display } = configuration;
  if (view_to_create) {
    const View = require("../models/view");
    const viewToCreate = View.findOne({ name: view_to_create });
    if (viewToCreate) {
      if (create_view_display === "Link" || create_view_display === "Popup") {
        return {
          linkedViews: [viewToCreate],
        };
      } else {
        return {
          embeddedViews: [viewToCreate],
        };
      }
    }
  }
  return null;
}

/**
 * helper to keep track of added nodes ('cyIds')
 */
class ExtractHelper {
  cyIds = new Set<string>();
  opts: ExtractOpts;

  constructor(opts: ExtractOpts) {
    this.opts = opts;
  }

  public async handleNodeConnections(
    oldNode: Node,
    connected: ConnectedObjects
  ) {
    if (this.opts.showViews)
      for (const embeddedView of connected.embeddedViews || []) {
        if (embeddedView && includeView(embeddedView, this.opts))
          await this.addEmbeddedView(oldNode, embeddedView);
      }
    if (this.opts.showPages)
      for (const linkedPage of connected.linkedPages || []) {
        if (linkedPage && includePage(linkedPage, this.opts))
          await this.addLinkedPageNode(oldNode, linkedPage);
      }
    if (this.opts.showViews)
      for (const linkedView of connected.linkedViews || []) {
        if (linkedView && includeView(linkedView, this.opts))
          await this.addLinkedViewNode(oldNode, linkedView);
      }
    if (this.opts.showTables)
      for (const table of connected.tables || []) {
        if (table && includeTable(table, this.opts)) {
          const tableNode = new TableNode(table, await table.getTags());

          this.cyIds.add(tableNode.cyId);
          if (this.opts.showTrigger) {
            const triggerNodes = new Array<Node>();
            for (const trigger of await Trigger.getAllTableTriggers(table)) {
              if (trigger && includeTrigger(trigger, this.opts)) {
                const newNode = new TriggerNode(
                  trigger,
                  await trigger.getTags()
                );
                this.cyIds.add(newNode.cyId);
                triggerNodes.push(newNode);
              }
            }
            if (triggerNodes.length > 0) tableNode.trigger = triggerNodes;
          }
          oldNode.tables.push(tableNode);
        }
      }
  }

  private async addLinkedViewNode(oldNode: Node, newView: View) {
    await newView.getTags();
    const newNode = new ViewNode(newView, await newView.getTags());
    oldNode.linked.push(newNode);
    if (!this.cyIds.has(newNode.cyId)) {
      this.cyIds.add(newNode.cyId);
      const connections = await newView.connected_objects();
      await setRefs(connections);
      await this.handleNodeConnections(newNode, connections);
    }
  }

  private async addEmbeddedView(oldNode: Node, embedded: View) {
    await embedded.getTags();
    const newNode = new ViewNode(embedded, await embedded.getTags());
    oldNode.embedded.push(newNode);
    if (!this.cyIds.has(newNode.cyId)) {
      this.cyIds.add(newNode.cyId);
      const connections = await embedded.connected_objects();
      await setRefs(connections);
      await this.handleNodeConnections(newNode, connections);
    }
  }

  private async addLinkedPageNode(oldNode: Node, newPage: Page) {
    await newPage.getTags();
    const newNode = new PageNode(newPage, await newPage.getTags());
    oldNode.linked.push(newNode);
    if (!this.cyIds.has(newNode.cyId)) {
      this.cyIds.add(newNode.cyId);
      const connections = await newPage.connected_objects();
      await setRefs(connections);
      await this.handleNodeConnections(newNode, connections);
    }
  }
}

const includePage = (page: Page, opts: ExtractOpts) => {
  if (opts.showPages) return checkFilterIds(page.id, opts.pageFilterIds);
  else return false;
};

const includeView = (view: View, opts: ExtractOpts) => {
  if (opts.showViews) return checkFilterIds(view.id, opts.viewFilterIds);
  else return false;
};

const includeTable = (table: Table, opts: ExtractOpts) => {
  if (opts.showTables) return checkFilterIds(table.id, opts.tableFilterIds);
  else return false;
};

const includeTrigger = (trigger: Trigger, opts: ExtractOpts) => {
  if (opts.showTrigger)
    return checkFilterIds(trigger.id, opts.triggerFilterIds);
  else return false;
};

const checkFilterIds = (
  id?: number | null,
  filterIds?: Set<number>
): boolean => {
  if (!filterIds) return true;
  else if (!id) return false;
  else return filterIds.has(id);
};
