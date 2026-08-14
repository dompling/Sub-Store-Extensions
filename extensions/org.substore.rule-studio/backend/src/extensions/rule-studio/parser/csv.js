export function splitRuleFields(line) {
    const fields = [];
    let field = '';
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (quote) {
            if (character === quote && line[index + 1] === quote) {
                field += quote;
                index += 1;
            } else if (character === quote) {
                quote = null;
            } else {
                field += character;
            }
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
        } else if (character === ',') {
            fields.push(field.trim());
            field = '';
        } else {
            field += character;
        }
    }
    fields.push(field.trim());
    return fields;
}
