function parseOptionLabel(label) {
  const text = String(label || '').trim();
  const match = text.match(/\(\s*\+?\s*([\d,]+)\s*원\s*\)\s*$/);
  return {
    name: match ? text.slice(0, match.index).trim() : text,
    extraPrice: match ? Number.parseInt(match[1].replaceAll(',', ''), 10) : 0
  };
}

function cartesian(groups) {
  return groups.reduce(
    (rows, group) => rows.flatMap(row => group.values.map(value => [...row, { groupName: group.name, ...value }])),
    [[]]
  );
}

function sanitizeCodePart(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, '').slice(-24) || 'OPT';
}

export function buildOptionInfo(sourceOptions, { stockQuantity = 999, sellerCode = 'PRODUCT', forceSoldOut = false } = {}) {
  if (!Array.isArray(sourceOptions) || sourceOptions.length === 0) return undefined;
  if (sourceOptions.length > 3) throw new Error('조합형 옵션 그룹은 최대 3개까지만 지원합니다.');

  const groups = sourceOptions.map(group => ({
    name: String(group.name || '').trim(),
    values: (group.values || []).map(value => ({
      ...parseOptionLabel(value.name),
      sourceCode: value.value,
      soldOut: Boolean(value.sold_out)
    }))
  }));
  if (groups.some(group => !group.name || group.values.length === 0)) {
    throw new Error('옵션 그룹명 또는 옵션값이 비어 있습니다.');
  }

  const optionCombinationGroupNames = {};
  groups.forEach((group, index) => {
    optionCombinationGroupNames[`optionGroupName${index + 1}`] = group.name;
  });

  const optionCombinations = cartesian(groups).map((combination, index) => {
    const soldOut = forceSoldOut || combination.some(value => value.soldOut);
    const row = {
      stockQuantity: soldOut ? 0 : Number(stockQuantity),
      price: combination.reduce((sum, value) => sum + value.extraPrice, 0),
      usable: !soldOut,
      sellerManagerCode: `${sellerCode}-${String(index + 1).padStart(3, '0')}-${sanitizeCodePart(combination.map(v => v.sourceCode).join('-'))}`.slice(0, 100)
    };
    combination.forEach((value, valueIndex) => {
      row[`optionName${valueIndex + 1}`] = value.name;
    });
    return row;
  });

  return {
    optionCombinationSortType: 'CREATE',
    optionCombinationGroupNames,
    optionCombinations,
    useStockManagement: true
  };
}

export { parseOptionLabel };
