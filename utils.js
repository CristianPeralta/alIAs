// Helper function to replace 'Ñ' or 'ñ' with 'Ð' in strings
export const replaceEnieToD = (str) => {
  if (typeof str === 'string') {
      return str.replace(/Ñ/g, 'Ð').replace(/ñ/g, 'ð');
  }
  return str;
};
// Helper function to replace 'Ð' or 'ð' with 'Ñ' or 'ñ' respectively in strings
export const replaceDToEnie = (str) => {
  if (typeof str === 'string') {
      return str.replace(/Ð/g, 'Ñ').replace(/ð/g, 'ñ');
  }
  return str;
};
  

