const { config, createCollectionIfNotExists, findOne, insertOne } = require('../backend/lib/database');

async function main() {
  const collectionsToCreate = ['users', 'services', 'partners', 'recommendation_questions', 'leads', 'form_help_requests', 'settings', 'contacts', 'claims', 'testimonials'];

  console.log(`Connected to MongoDB.`);
  console.log(`Initializing database: ${config.mongodbDatabase}\n`);

  for (const collectionName of collectionsToCreate) {
    try {
      const created = await createCollectionIfNotExists(collectionName);
      if (created) {
        console.log(`✅ Collection created: ${collectionName}`);
      } else {
        console.log(`ℹ️ Collection already exists: ${collectionName}`);
      }
    } catch (error) {
      console.log(`❌ Error creating ${collectionName}: ${error.message}`);
    }
  }

  const existingAdmin = await findOne('users', { email: config.adminEmail });
  if (existingAdmin === null) {
    await insertOne('users', {
      name: 'Super Admin',
      email: config.adminEmail,
      password: config.adminPassword,
      role: 'admin',
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
    });
    console.log(`\n🔑 Default Admin created: ${config.adminEmail}`);
  } else {
    console.log('\n🔑 Admin user already exists.');
  }

  const existingSettings = await findOne('settings', { _id: 'global' });
  if (existingSettings === null) {
    await insertOne('settings', {
      _id: 'global',
      supportEmail: 'support@twinsure.com',
      supportPhone: '+91 9750003600',
      whatsappGroupLink:
        'https://wa.me/919750003600?text=Hello,%20I%20would%20like%20to%20know%20more%20about%20Twinsure%20services.',
      officeAddress: 'Twinsure H.Q., Chennai, Tamil Nadu - 600xxx',
      workingHours: 'Mon-Fri: 9AM - 6PM',
      timeZone: 'IST',
      defaultLanguage: 'English',
      maintenanceMode: false,
      whatsappButton: true,
      emailNotifications: true,
      whatsappNotifications: true,
      leadAlerts: true,
      partnerAlerts: true,
      claimAlerts: true,
      notificationPriority: 'high',
      sessionTimeout: '60',
      loginAttempts: '5',
      recEngineEnabled: true,
      leadPopup: true,
      callbackSlot: true,
      partnerRegEnabled: true,
      referralTracking: true,
      publicCommissionInfo: false,
      minCommission: '5',
      maxCommission: '25',
      manualPartnerApproval: true,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
    });
    console.log('\n⚙️ Default Settings initialized.');
  } else {
    console.log('\n⚙️ Settings already exist.');
  }

  // Seed testimonials if collection is empty
  const existingTestimonials = await findOne('testimonials', {});
  if (existingTestimonials === null) {
    const initialTestimonials = [
      {
        name: 'Murugan',
        from: 'from Karur',
        before: 'I am Murugan from Karur. About six months ago, I suffered a heart attack and was advised to undergo heart surgery at a hospital in Coimbatore. The surgery would cost around ₹6 lakh. Since I had a Star Health Insurance policy, I submitted a claim, but it was rejected. After being discharged and returning home, I submitted the claim again, but it was rejected once more for different reasons.',
        helped: 'At that point, a friend recommended Twins Consultancy. I immediately contacted them and shared all the necessary details. From the very beginning, their team guided me with speed and clarity. They explained exactly what needed to be done, how to submit the documents correctly, and what corrections were required. They carefully reviewed my case, corrected every mistake, and handled the entire process efficiently.',
        after: 'Thanks to the efforts of Twins Consultancy, I successfully received my insurance claim amount of ₹6 lakh this week. I am extremely happy and satisfied with the support they provided. Their guidance made a difficult process much easier.',
        avatarUrl: 'https://ui-avatars.com/api/?name=Murugan&background=random',
        displayOrder: 1,
        isActive: true,
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      },
      {
        name: 'Lokanathan',
        from: 'Teacher from Chinnatharapuram',
        before: 'I am Lokanathan, a teacher from Chinnatharapuram. I had taken the Star Super Plus Policy through Twins Consultancy. Recently, I underwent surgical treatment at Royal Care Hospital. At that time, I was unable to receive the payment directly through the policy. Since I am a government employee, the policy was not directly applicable, and I had to seek reimbursement through the government scheme. Additionally, there were challenges in obtaining the eligible amount through my Star Health Policy.',
        helped: 'I am extremely grateful to Mr. Lakshmanan from Twins Consultancy, who personally guided and assisted me throughout the reimbursement process. He carefully handled the complexities involved in claiming benefits under the government policy and also addressed the issues related to my Star Health Policy. Even though it was a top-up policy and I initially considered leaving the matter as it was, Mr. Lakshmanan remained committed to ensuring that I received the amount I was rightfully entitled to.',
        after: 'Thanks to the dedicated efforts of Mr. Lakshmanan and the team at Twins Consultancy, I successfully received the reimbursement amount that I was eligible for. I will always remain thankful for their support, dedication, and persistence.',
        avatarUrl: 'https://ui-avatars.com/api/?name=Lokanathan&background=random',
        displayOrder: 2,
        isActive: true,
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      }
    ];
    
    for (const testimonial of initialTestimonials) {
      await insertOne('testimonials', testimonial);
    }
    console.log('\n📝 Initial testimonials seeded successfully.');
  } else {
    console.log('\n📝 Testimonials already exist.');
  }

  console.log('\n🎉 Database initialization complete!');
}

main().catch((error) => {
  console.error(`\n❌ Connection error: ${error.message}`);
  process.exit(1);
});