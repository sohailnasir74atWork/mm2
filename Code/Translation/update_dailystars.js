const fs = require('fs');
const translations = {
  en: "Daily Stars",
  es: "Estrellas Diarias",
  fr: "Étoiles Quotidiennes",
  de: "Tägliche Sterne",
  ar: "نجوم يومية"
};

const languages = ['en', 'es', 'fr', 'de', 'ar'];

languages.forEach(lang => {
  const filePath = `./Code/Translation/${lang}.json`;
  let data = {};
  if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  if (!data['home']) data['home'] = {};
  data['home']['daily_stars'] = translations[lang];

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Updated ${lang}.json`);
});
