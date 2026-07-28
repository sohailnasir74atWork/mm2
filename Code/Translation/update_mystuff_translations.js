const fs = require('fs');

const translations = {
  en: {
    my_items: "My Items",
    my_goals: "My Goals",
    unknown: "Unknown",
    title: "My Stuff",
    inventory_value: "Inventory Value",
    goals_value: "Goals Value",
    items_count: "Items",
    no_items_yet: "No items yet",
    no_goals_yet: "No goals yet",
    add_items_desc: "Add the items you own to track your portfolio",
    add_goals_desc: "Add items you want to set your trading goals",
    sign_in_desc: "Sign in to start tracking your inventory",
    add_items: "Add Items",
    sign_in: "Sign In",
    edit_items: "Edit Items",
    edit_goals: "Edit Goals",
    sign_in_manage: "Sign in to manage your inventory"
  },
  es: {
    my_items: "Mis Botines",
    my_goals: "Mis Metas",
    unknown: "Desconocido",
    title: "Mis Cosas",
    inventory_value: "Valor de Inventario",
    goals_value: "Valor de Metas",
    items_count: "Artículos",
    no_items_yet: "Sin artículos",
    no_goals_yet: "Sin metas",
    add_items_desc: "Añade los artículos que posees para rastrear tu portafolio",
    add_goals_desc: "Añade artículos que deseas para establecer tus metas de intercambio",
    sign_in_desc: "Inicia sesión para comenzar a rastrear tu inventario",
    add_items: "Añadir Artículos",
    sign_in: "Iniciar Sesión",
    edit_items: "Editar Artículos",
    edit_goals: "Editar Metas",
    sign_in_manage: "Inicia sesión para administrar tu inventario"
  },
  fr: {
    my_items: "Mes Objets",
    my_goals: "Mes Objectifs",
    unknown: "Inconnu",
    title: "Mes Affaires",
    inventory_value: "Valeur de l'inventaire",
    goals_value: "Valeur des objectifs",
    items_count: "Objets",
    no_items_yet: "Aucun objet",
    no_goals_yet: "Aucun objectif",
    add_items_desc: "Ajoutez les objets que vous possédez pour suivre votre portefeuille",
    add_goals_desc: "Ajoutez les objets que vous souhaitez pour fixer vos objectifs",
    sign_in_desc: "Connectez-vous pour commencer à suivre votre inventaire",
    add_items: "Ajouter des objets",
    sign_in: "Se connecter",
    edit_items: "Modifier les objets",
    edit_goals: "Modifier les objectifs",
    sign_in_manage: "Connectez-vous pour gérer votre inventaire"
  },
  de: {
    my_items: "Meine Items",
    my_goals: "Meine Ziele",
    unknown: "Unbekannt",
    title: "Mein Inventar",
    inventory_value: "Inventarwert",
    goals_value: "Zielwert",
    items_count: "Items",
    no_items_yet: "Noch keine Items",
    no_goals_yet: "Noch keine Ziele",
    add_items_desc: "Füge deine Items hinzu, um dein Portfolio zu verfolgen",
    add_goals_desc: "Füg Items hinzu, um deine Tauschziele festzulegen",
    sign_in_desc: "Melde dich an, um dein Inventar zu verfolgen",
    add_items: "Items hinzufügen",
    sign_in: "Anmelden",
    edit_items: "Items bearbeiten",
    edit_goals: "Ziele bearbeiten",
    sign_in_manage: "Melde dich an, um dein Inventar zu verwalten"
  },
  ar: {
    my_items: "أشيائي",
    my_goals: "أهدافي",
    unknown: "غير معروف",
    title: "أغراضي",
    inventory_value: "قيمة المخزون",
    goals_value: "قيمة الأهداف",
    items_count: "العناصر",
    no_items_yet: "لا توجد عناصر بعد",
    no_goals_yet: "لا توجد أهداف بعد",
    add_items_desc: "أضف العناصر التي تمتلكها لتتبع محفظتك",
    add_goals_desc: "أضف العناصر التي تريدها لتحديد أهداف التداول الخاصة بك",
    sign_in_desc: "سجل الدخول لبدء تتبع مخزونك",
    add_items: "إضافة عناصر",
    sign_in: "تسجيل الدخول",
    edit_items: "تعديل العناصر",
    edit_goals: "تعديل الأهداف",
    sign_in_manage: "سجل الدخول لإدارة مخزونك"
  }
};

const languages = ['en', 'es', 'fr', 'de', 'ar'];

languages.forEach(lang => {
  const filePath = `./Code/Translation/${lang}.json`;
  let data = {};
  if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  
  data['mystuff'] = translations[lang];

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Updated ${lang}.json`);
});
