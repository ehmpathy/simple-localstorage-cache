if (
  process.env.NODE_ENV !== 'test' &&
  process.env.I_KNOW_WHAT_IM_DOING !== 'true'
)
  throw new Error(`unit-test is not targeting stage 'test'`);
