const fs = require('fs');
const translations = {
  en: "My Stuff Worth",
  es: "Valor de mis cosas",
  fr: "Valeur de mes objets",
  de: "Mein Inventarwert",
  ar: "قيمة أشيائي"
};

const languages = ['en', 'es', 'fr', 'de', 'ar'];

languages.forEach(lang => {
  const filePath = `./Code/Translation/${lang}.json`;
  let data = {};
  if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  if (!data['home']) data['home'] = {};
  data['home']['my_stuff_worth'] = translations[lang];

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Updated ${lang}.json`);
});
