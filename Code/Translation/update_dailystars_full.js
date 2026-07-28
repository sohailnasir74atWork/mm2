const fs = require('fs');

const translations = {
  en: {
    title: "⭐ Daily Stars",
    streak_broken: "😢 Streak broken! Starting over from Day 1",
    already_claimed: "✅ Already claimed today! Come back tomorrow",
    day: "Day",
    tap: "TAP!",
    cycle_info: "Cycle #{{cycle}} · {{stars}} stars earned",
    welcome_back: "Welcome back!",
    keep_going: "Keep going!",
    hat_trick: "Hat trick!",
    on_fire: "On fire!",
    halfway_hero: "Halfway hero!",
    almost_there: "Almost there!",
    jackpot_day: "Jackpot Day!"
  },
  es: {
    title: "⭐ Estrellas Diarias",
    streak_broken: "😢 ¡Racha rota! Empezando de nuevo desde el Día 1",
    already_claimed: "✅ ¡Ya reclamado hoy! Vuelve mañana",
    day: "Día",
    tap: "¡TOCA!",
    cycle_info: "Ciclo #{{cycle}} · {{stars}} estrellas ganadas",
    welcome_back: "¡Bienvenido de nuevo!",
    keep_going: "¡Sigue así!",
    hat_trick: "¡Hat trick!",
    on_fire: "¡En racha!",
    halfway_hero: "¡Héroe a medias!",
    almost_there: "¡Casi allí!",
    jackpot_day: "¡Día del Premio Mayor!"
  },
  fr: {
    title: "⭐ Étoiles Quotidiennes",
    streak_broken: "😢 Série brisée ! Reprise à partir du Jour 1",
    already_claimed: "✅ Déjà réclamé aujourd'hui ! Reviens demain",
    day: "Jour",
    tap: "TAPE !",
    cycle_info: "Cycle #{{cycle}} · {{stars}} étoiles gagnées",
    welcome_back: "Bon retour !",
    keep_going: "Continue comme ça !",
    hat_trick: "Coup du chapeau !",
    on_fire: "En feu !",
    halfway_hero: "Héros à mi-chemin !",
    almost_there: "Presque là !",
    jackpot_day: "Jour de Jackpot !"
  },
  de: {
    title: "⭐ Tägliche Sterne",
    streak_broken: "😢 Strähne gerissen! Neustart ab Tag 1",
    already_claimed: "✅ Heute schon eingelöst! Komm morgen wieder",
    day: "Tag",
    tap: "TIPPEN!",
    cycle_info: "Zyklus #{{cycle}} · {{stars}} Sterne verdient",
    welcome_back: "Willkommen zurück!",
    keep_going: "Mach weiter so!",
    hat_trick: "Hattrick!",
    on_fire: "Läuft bei dir!",
    halfway_hero: "Halbzeit-Held!",
    almost_there: "Fast geschafft!",
    jackpot_day: "Jackpot-Tag!"
  },
  ar: {
    title: "⭐ النجوم اليومية",
    streak_broken: "😢 انقطعت السلسلة! البدء من جديد من اليوم الأول",
    already_claimed: "✅ تمت المطالبة اليوم! عد غداً",
    day: "يوم",
    tap: "اضغط!",
    cycle_info: "الدورة رقم {{cycle}} · تم ربح {{stars}} نجوم",
    welcome_back: "مرحباً بعودتك!",
    keep_going: "استمر!",
    hat_trick: "ثلاثية!",
    on_fire: "أنت متألق!",
    halfway_hero: "بطل منتصف الطريق!",
    almost_there: "اقتربت!",
    jackpot_day: "يوم الجائزة الكبرى!"
  }
};

const languages = ['en', 'es', 'fr', 'de', 'ar'];

languages.forEach(lang => {
  const filePath = `./Code/Translation/${lang}.json`;
  let data = {};
  if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  data['daily_stars'] = translations[lang];

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Updated ${lang}.json`);
});
