import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DueDateMenu } from "./DueDateMenu";
import { LanguageProvider } from "@/hooks/useLanguage";

function renderDueDate(dueDate: string): string {
  return renderToStaticMarkup(
    createElement(
      LanguageProvider,
      null,
      createElement(DueDateMenu, {
        dueDate,
        onChangeDue: () => {},
        readOnly: true,
      })
    )
  );
}

test("renders due dates as Casablanca calendar days in the task list and details control", () => {
  assert.match(renderDueDate("2026-10-10T00:00:00Z"), /10 oct\./);
  assert.match(renderDueDate("2026-10-08T23:00:00Z"), /9 oct\./);
});
