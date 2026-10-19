// Expands an Adaptive Card template with sample data using Microsoft's templating SDK.
// Usage: node design/tools/expand-card.cjs <template.json> <data.json> <out.json>
const fs = require("fs");
const ACData = require("adaptivecards-templating");

const [templatePath, dataPath, outPath] = process.argv.slice(2);
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const card = new ACData.Template(template).expand({ $root: data });
fs.writeFileSync(outPath, JSON.stringify(card, null, 2));
