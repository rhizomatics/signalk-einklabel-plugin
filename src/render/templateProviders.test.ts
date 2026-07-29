import test from "node:test";
import assert from "node:assert/strict";
import { allTemplateProviders, findTemplateProvider, registerTemplateProvider, TemplateProvider } from "./templateProviders";

function fakeProvider(suffix: string, names: string[]): TemplateProvider {
  return {
    suffix,
    listTemplates: () => names.map((name) => `${name} ${suffix}`),
    describeBindings: () => [],
    render: async () => {
      throw new Error("not implemented in this fake");
    },
  };
}

test("templateProviders registry", async (t) => {
  await t.test("findTemplateProvider finds the provider offering an exact template name", () => {
    const provider = fakeProvider("(Test A)", ["alpha"]);
    registerTemplateProvider(provider);
    assert.equal(findTemplateProvider("alpha (Test A)"), provider);
  });

  await t.test("findTemplateProvider returns undefined for a name no provider offers", () => {
    assert.equal(findTemplateProvider("does-not-exist (Test A)"), undefined);
  });

  await t.test("allTemplateProviders lists every registered provider", () => {
    const before = allTemplateProviders().length;
    registerTemplateProvider(fakeProvider("(Test B)", ["beta"]));
    assert.equal(allTemplateProviders().length, before + 1);
  });
});
