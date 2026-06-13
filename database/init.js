const { config, createCollectionIfNotExists, findOne, insertOne, ObjectId } = require('../backend/lib/database');

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

  // Seed claims if collection is empty
  const existingClaims = await findOne('claims', {});
  if (existingClaims === null) {
    console.log('\nSeeding initial claims...');
    const initialClaims = [
      {
        _id: new ObjectId("6a2849c79c64d9a23efcd2fe"),
        name: "Care Health: Claim Form (Reimbursement)",
        category: "Health",
        description: "Standard Care Health claim form for reimbursement. Part A to be filled by the insured, Part B by the hospital.",
        status: "active",
        fileName: "1781025223_CARE_HEALTH_CLAIM_FORM.pdf",
        filePath: "uploads/claims/1781025223_CARE_HEALTH_CLAIM_FORM.pdf",
        fileSize: "1.5 MB",
        downloads: 2,
        uploadedBy: "Naresh",
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      },
      {
        _id: new ObjectId("6a276d18e8bb34d38376685d"),
        name: "Care Health: Pre-Authorization Form",
        category: "Health",
        description: "FAX/SCAN Page 1 & 2 only to Care Health for cashless approval. Page 3 (Declaration) should NOT be faxed.\n\nPage 1 & 2 மட்டும் FAX/SCAN செய்யுங்கள். Page 3 (Declaration) fax செய்யாதீர்கள்.",
        status: "active",
        fileName: "1780968728_care-pre-authorization-form.pdf",
        filePath: "uploads/claims/1780968728_care-pre-authorization-form.pdf",
        fileSize: "100 KB",
        downloads: 1,
        uploadedBy: "Naresh",
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      },
      {
        _id: new ObjectId("6a276cece8bb34d38376685c"),
        name: "Chola MS: Health Claim Form (Reimbursement)",
        category: "Health",
        description: "Submit claim documents within 30 days of discharge. NEFT cannot be done without a cancelled cheque — always attach one.\n\nDischarge-ஆன 30 நாட்களில் submit செய்யுங்கள். Cancelled cheque இல்லாமல் NEFT முடியாது — எப்போதும் attach செய்யுங்கள்.",
        status: "active",
        fileName: "1780968684_CHOLA_Health-Claim-Form.pdf",
        filePath: "uploads/claims/1780968684_CHOLA_Health-Claim-Form.pdf",
        fileSize: "3.1 MB",
        downloads: 0,
        uploadedBy: "Naresh",
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      },
      {
        _id: new ObjectId("6a276cbde8bb34d38376685b"),
        name: "Chola MS: Pre-Authorization Form for Cashless",
        category: "Others",
        description: "FAX/SCAN PAGE 1 ONLY to Chola MS for cashless approval before or during hospital admission.\n\nCashless approval-க்கு PAGE 1 மட்டும் FAX/SCAN செய்யுங்கள் — hospitalization-க்கு முன்பு அல்லது நேரத்தில்.",
        status: "active",
        fileName: "1780968637_Chola-MS-Pre-Authorisation-Form.pdf",
        filePath: "uploads/claims/1780968637_Chola-MS-Pre-Authorisation-Form.pdf",
        fileSize: "926 KB",
        downloads: 0,
        uploadedBy: "Naresh",
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      },
      {
        _id: new ObjectId("6a276c8ee8bb34d38376685a"),
        name: "ICICI Lombard: Hospitalization Claim Form",
        category: "Health",
        description: "Full reimbursement claim form with 4 parts. Submit with all original bills within 30 days of discharge.\n\n4 parts உள்ள complete reimbursement claim form. Discharge-ஆன 30 நாட்களில் original bills-உடன் submit செய்யவும்.",
        status: "active",
        fileName: "1780968590_icici_claim_form.pdf",
        filePath: "uploads/claims/1780968590_icici_claim_form.pdf",
        fileSize: "367 KB",
        downloads: 0,
        uploadedBy: "Naresh",
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      },
      {
        _id: new ObjectId("6a276c49e8bb34d383766859"),
        name: "ICICI Lombard: Cashless Authorization Request Form",
        category: "Others",
        description: "Used to request cashless treatment before or during hospitalization. Send by fax or email to ICICI Lombard's cashless team.\n\nHospitalization-க்கு முன்பு அல்லது நேரத்தில் cashless கோர பயன்படும். Fax / email மூலம் ICICI-க்கு அனுப்பவும்.",
        status: "active",
        fileName: "1780968521_ICICI_LOMBOARD-pre-authorisation-form.pdf",
        filePath: "uploads/claims/1780968521_ICICI_LOMBOARD-pre-authorisation-form.pdf",
        fileSize: "55 KB",
        downloads: 0,
        uploadedBy: "Naresh",
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      },
      {
        _id: new ObjectId("6a276c16e8bb34d383766858"),
        name: "Niva Bupa: Health Insurance Claim Form",
        category: "Health",
        description: "Standard health claim form. Part A filled by insured. Part B filled by hospital. Submit within 30 days of discharge.\n\nStandard health claim form. Part A-வை insured, Part B-வை hospital fill செய்யும். Discharge-ஆன 30 நாட்களில் submit செய்யுங்கள்.",
        status: "active",
        fileName: "1780968470_NIVA_BUPA_claim-form.pdf",
        filePath: "uploads/claims/1780968470_NIVA_BUPA_claim-form.pdf",
        fileSize: "453 KB",
        downloads: 0,
        uploadedBy: "Naresh",
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      },
      {
        _id: new ObjectId("6a276b7fe8bb34d383766857"),
        name: "Star Health: Accident Care Insurance Claim Form",
        category: "Health",
        description: "Used for accident-related insurance claims. Submit after accident to claim compensation for injury, disability, or death.\n\nவிபத்து காரணமாக ஏற்பட்ட காயம், மரணம் அல்லது disability-க்கு பணம் கோர பயன்படும்.",
        status: "active",
        fileName: "1780968319_STAR_accident_claim_form.pdf",
        filePath: "uploads/claims/1780968319_STAR_accident_claim_form.pdf",
        fileSize: "327 KB",
        downloads: 0,
        uploadedBy: "Naresh",
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      },
      {
        _id: new ObjectId("6a276b30e8bb34d383766856"),
        name: "Star Health: Pre-Authorization Form for Cashless",
        category: "Health",
        description: "This form is sent to Star Health BEFORE admission for cashless treatment. Hospital fills most of it. Patient fills personal details.\n\nஇந்த form hospitalization-க்கு முன்பே cashless-க்கு அனுமதி கேட்க பயன்படுகிறது. Hospital பெரும்பாலும் fill செய்யும்.",
        status: "active",
        fileName: "1780968240_StarHealthPreAuthForm.pdf",
        filePath: "uploads/claims/1780968240_StarHealthPreAuthForm.pdf",
        fileSize: "642 KB",
        downloads: 0,
        uploadedBy: "Naresh",
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      }
    ];
    for (const claim of initialClaims) {
      await insertOne('claims', claim);
    }
    console.log('📝 Initial claims seeded successfully.');
  } else {
    console.log('\n📝 Claims already exist.');
  }

  console.log('\n🎉 Database initialization complete!');
}

main().catch((error) => {
  console.error(`\n❌ Connection error: ${error.message}`);
  process.exit(1);
});