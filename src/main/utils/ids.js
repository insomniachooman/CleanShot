"use strict";

const parseSourceId = (sourceId) => {
  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    return null;
  }
  const [type, handle, display] = sourceId.split(":");
  if (!type || !handle) {
    return null;
  }
  return {
    type,
    handle,
    display: display ?? null,
  };
};

module.exports = {
  parseSourceId,
};