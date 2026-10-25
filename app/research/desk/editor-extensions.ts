import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { Plugin } from "@tiptap/pm/state";
import { deskText } from "./document";

export function deskExtensions(budget: () => number = () => 6000) {
  return [
    StarterKit.configure({ blockquote: false, bulletList: false, code: false, codeBlock: false, heading: false, horizontalRule: false, italic: false, link: false, listItem: false, listKeymap: false, orderedList: false, strike: false, underline: false, trailingNode: false, dropcursor: false, gapcursor: false }),
    TextStyle, Color, Highlight.configure({ HTMLAttributes: { style: "background-color:#705b00;color:inherit" } }),
    Extension.create({ name: "deskLength", addProseMirrorPlugins() { return [new Plugin({ filterTransaction(transaction) { return !transaction.docChanged || deskText(transaction.doc.toJSON()).length <= budget(); } })]; } }),
  ];
}
