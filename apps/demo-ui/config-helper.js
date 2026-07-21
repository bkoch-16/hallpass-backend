function getUserApiBase() {
  const group = CONFIG.groups.find(g => g.name === 'User-API');
  return group?.baseUrls?.[CONFIG.stages[0]] ?? '';
}
