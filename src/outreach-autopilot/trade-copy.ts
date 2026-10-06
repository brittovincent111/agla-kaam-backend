import type { TradeKind } from '../lead-finder/trades';

/**
 * The opening of each autopilot email, per kind of work and language: the
 * one question that kind of business recognises, then the same Agla Kaam
 * paragraph for everyone. Bodies carry {{tradeLine}} where it goes.
 *
 * Languages without their own lines (te, mr) use English. Have a native
 * speaker read hi / ml / ta / kn before switching the autopilot on.
 */
export const TRADE_COPY: Record<string, Record<TradeKind, { subject: string; line: string }>> = {
  en: {
    service: {
      subject: "Your customers' next service date, handled automatically",
      line: "Quick question: how do you keep track of when each customer is due for their next service, 3 or 6 months later? Many customers forget the date and call someone else.",
    },
    vehicle: {
      subject: 'Bring customers back for their next vehicle service',
      line: "Quick question: when a customer's car or bike is due for its next service — after 6 months or a few thousand km — how do you remind them? Many simply go to another garage.",
    },
    amc: {
      subject: 'AMC renewals and scheduled visits, without the spreadsheet',
      line: 'Quick question: how do you keep track of AMC renewals and the scheduled visits under each contract? A missed renewal is usually a lost customer.',
    },
    pest: {
      subject: 'Quarterly treatments, reminded automatically',
      line: 'Quick question: how do you keep track of which customers are due for their next treatment — every 3 months, or the yearly termite check? Most don\'t call back on their own.',
    },
    solar: {
      subject: 'Panel cleaning and battery checks, reminded automatically',
      line: 'Quick question: how do you remind customers when their solar panels need cleaning or their inverter battery needs a check? Done on time, it brings you steady repeat work.',
    },
    job: {
      subject: 'Quotations, GST bills and repeat jobs from your phone',
      line: 'Quick question: how do you send quotations and bills to customers today, and how do your old customers find you again for the next job?',
    },
  },
  hi: {
    service: {
      subject: 'ग्राहकों की अगली सर्विस की तारीख — अपने-आप याद',
      line: 'एक छोटा-सा सवाल: 3 या 6 महीने बाद किस ग्राहक की अगली सर्विस ड्यू है, यह आप कैसे याद रखते हैं? कई ग्राहक तारीख भूल जाते हैं और किसी और को बुला लेते हैं।',
    },
    vehicle: {
      subject: 'ग्राहकों को अगली गाड़ी सर्विस के लिए वापस लाएँ',
      line: 'एक छोटा-सा सवाल: जब किसी ग्राहक की कार या बाइक की अगली सर्विस ड्यू होती है — 6 महीने या कुछ हज़ार किलोमीटर बाद — तो आप उन्हें कैसे याद दिलाते हैं? कई ग्राहक दूसरे गैराज चले जाते हैं।',
    },
    amc: {
      subject: 'AMC रिन्यूअल और तय विज़िट — बिना रजिस्टर के',
      line: 'एक छोटा-सा सवाल: AMC रिन्यूअल और हर कॉन्ट्रैक्ट की तय विज़िट आप कैसे ट्रैक करते हैं? छूटा हुआ रिन्यूअल अक्सर खोया हुआ ग्राहक होता है।',
    },
    pest: {
      subject: 'तिमाही ट्रीटमेंट — अपने-आप याद दिलाएँ',
      line: 'एक छोटा-सा सवाल: किस ग्राहक का अगला ट्रीटमेंट ड्यू है — हर 3 महीने वाला, या सालाना दीमक जाँच — यह आप कैसे याद रखते हैं? ज़्यादातर ग्राहक खुद फ़ोन नहीं करते।',
    },
    solar: {
      subject: 'पैनल सफ़ाई और बैटरी जाँच — अपने-आप याद',
      line: 'एक छोटा-सा सवाल: ग्राहकों के सोलर पैनल की सफ़ाई या इन्वर्टर बैटरी की जाँच का समय होने पर आप उन्हें कैसे याद दिलाते हैं? समय पर हो तो यह लगातार दोबारा काम लाता है।',
    },
    job: {
      subject: 'कोटेशन, GST बिल और दोबारा काम — फ़ोन से',
      line: 'एक छोटा-सा सवाल: आज आप ग्राहकों को कोटेशन और बिल कैसे भेजते हैं, और पुराने ग्राहक अगले काम के लिए आपको दोबारा कैसे बुलाते हैं?',
    },
  },
  ml: {
    service: {
      subject: 'കസ്റ്റമേഴ്സിന്റെ അടുത്ത സർവീസ് തീയതി — തനിയെ ഓർമ്മിപ്പിക്കാം',
      line: 'ഒരു ചെറിയ ചോദ്യം: 3 അല്ലെങ്കിൽ 6 മാസം കഴിഞ്ഞ് ഓരോ കസ്റ്റമറുടെയും അടുത്ത സർവീസ് എപ്പോഴാണെന്ന് എങ്ങനെയാണ് ഓർത്തുവയ്ക്കുന്നത്? പല കസ്റ്റമേഴ്സും തീയതി മറന്ന് വേറെ ആരെയെങ്കിലും വിളിക്കും.',
    },
    vehicle: {
      subject: 'അടുത്ത വാഹന സർവീസിന് കസ്റ്റമേഴ്സിനെ തിരികെ കൊണ്ടുവരാം',
      line: 'ഒരു ചെറിയ ചോദ്യം: ഒരു കസ്റ്റമറുടെ കാറിനോ ബൈക്കിനോ അടുത്ത സർവീസ് സമയമാകുമ്പോൾ — 6 മാസം അല്ലെങ്കിൽ കുറച്ച് ആയിരം കിലോമീറ്റർ കഴിഞ്ഞ് — എങ്ങനെയാണ് ഓർമ്മിപ്പിക്കുന്നത്? പലരും വേറെ വർക്ക്ഷോപ്പിലേക്ക് പോകും.',
    },
    amc: {
      subject: 'AMC പുതുക്കലും നിശ്ചിത വിസിറ്റുകളും — രജിസ്റ്റർ ഇല്ലാതെ',
      line: 'ഒരു ചെറിയ ചോദ്യം: AMC പുതുക്കലും ഓരോ കോൺട്രാക്റ്റിലെയും നിശ്ചിത വിസിറ്റുകളും എങ്ങനെയാണ് ട്രാക്ക് ചെയ്യുന്നത്? പുതുക്കാൻ വിട്ടുപോയാൽ സാധാരണയായി കസ്റ്റമറെ നഷ്ടപ്പെടും.',
    },
    pest: {
      subject: 'മൂന്നുമാസത്തിലൊരിക്കലുള്ള ട്രീറ്റ്മെന്റ് — തനിയെ ഓർമ്മിപ്പിക്കാം',
      line: 'ഒരു ചെറിയ ചോദ്യം: ഏത് കസ്റ്റമർക്കാണ് അടുത്ത ട്രീറ്റ്മെന്റ് — 3 മാസത്തിലൊരിക്കലുള്ളതോ വാർഷിക ചിതൽ പരിശോധനയോ — എന്ന് എങ്ങനെയാണ് ഓർക്കുന്നത്? മിക്കവരും സ്വയം വിളിക്കാറില്ല.',
    },
    solar: {
      subject: 'പാനൽ ക്ലീനിംഗും ബാറ്ററി ചെക്കും — തനിയെ ഓർമ്മിപ്പിക്കാം',
      line: 'ഒരു ചെറിയ ചോദ്യം: സോളാർ പാനൽ വൃത്തിയാക്കേണ്ട സമയമോ ഇൻവെർട്ടർ ബാറ്ററി പരിശോധിക്കേണ്ട സമയമോ ആകുമ്പോൾ കസ്റ്റമേഴ്സിനെ എങ്ങനെയാണ് ഓർമ്മിപ്പിക്കുന്നത്? കൃത്യസമയത്ത് ചെയ്താൽ ഇത് സ്ഥിരമായ ജോലി തരും.',
    },
    job: {
      subject: 'ക്വട്ടേഷൻ, GST ബിൽ, വീണ്ടും ജോലി — ഫോണിൽ നിന്ന്',
      line: 'ഒരു ചെറിയ ചോദ്യം: ഇപ്പോൾ കസ്റ്റമേഴ്സിന് ക്വട്ടേഷനും ബില്ലും എങ്ങനെയാണ് അയയ്ക്കുന്നത്, പഴയ കസ്റ്റമേഴ്സ് അടുത്ത ജോലിക്ക് വീണ്ടും നിങ്ങളെ എങ്ങനെ കണ്ടെത്തും?',
    },
  },
  ta: {
    service: {
      subject: 'வாடிக்கையாளர்களின் அடுத்த சர்வீஸ் தேதி — தானாகவே நினைவூட்டல்',
      line: 'ஒரு சிறிய கேள்வி: 3 அல்லது 6 மாதங்களுக்குப் பிறகு ஒவ்வொரு வாடிக்கையாளரின் அடுத்த சர்வீஸ் எப்போது என்பதை எப்படி நினைவில் வைக்கிறீர்கள்? பல வாடிக்கையாளர்கள் தேதியை மறந்து வேறு ஒருவரை அழைத்துவிடுகிறார்கள்.',
    },
    vehicle: {
      subject: 'அடுத்த வாகன சர்வீஸுக்கு வாடிக்கையாளர்களை மீண்டும் வர வையுங்கள்',
      line: 'ஒரு சிறிய கேள்வி: ஒரு வாடிக்கையாளரின் கார் அல்லது பைக்கிற்கு அடுத்த சர்வீஸ் — 6 மாதங்கள் அல்லது சில ஆயிரம் கி.மீ. கழித்து — வரும்போது எப்படி நினைவூட்டுகிறீர்கள்? பலர் வேறு வொர்க்ஷாப்புக்குப் போய்விடுகிறார்கள்.',
    },
    amc: {
      subject: 'AMC புதுப்பித்தல் மற்றும் திட்டமிட்ட விசிட்கள் — பதிவேடு இல்லாமல்',
      line: 'ஒரு சிறிய கேள்வி: AMC புதுப்பித்தல்களையும் ஒவ்வொரு ஒப்பந்தத்தின் திட்டமிட்ட விசிட்களையும் எப்படி கண்காணிக்கிறீர்கள்? தவறிய புதுப்பித்தல் பொதுவாக இழந்த வாடிக்கையாளர்.',
    },
    pest: {
      subject: 'காலாண்டு ட்ரீட்மென்ட் — தானாகவே நினைவூட்டல்',
      line: 'ஒரு சிறிய கேள்வி: எந்த வாடிக்கையாளருக்கு அடுத்த ட்ரீட்மென்ட் — 3 மாதத்திற்கு ஒருமுறை அல்லது வருடாந்திர கரையான் சோதனை — வர வேண்டும் என்பதை எப்படி நினைவில் வைக்கிறீர்கள்? பெரும்பாலானோர் தாங்களாக அழைப்பதில்லை.',
    },
    solar: {
      subject: 'பேனல் சுத்தம் மற்றும் பேட்டரி சோதனை — தானாகவே நினைவூட்டல்',
      line: 'ஒரு சிறிய கேள்வி: சோலார் பேனல் சுத்தம் செய்யவோ இன்வெர்ட்டர் பேட்டரியைச் சோதிக்கவோ நேரம் வரும்போது வாடிக்கையாளர்களுக்கு எப்படி நினைவூட்டுகிறீர்கள்? சரியான நேரத்தில் செய்தால் இது தொடர்ச்சியான வேலையைத் தரும்.',
    },
    job: {
      subject: 'கொட்டேஷன், GST பில், மீண்டும் வேலை — போனிலிருந்தே',
      line: 'ஒரு சிறிய கேள்வி: இப்போது வாடிக்கையாளர்களுக்கு கொட்டேஷனும் பில்லும் எப்படி அனுப்புகிறீர்கள், பழைய வாடிக்கையாளர்கள் அடுத்த வேலைக்கு உங்களை மீண்டும் எப்படி கண்டுபிடிக்கிறார்கள்?',
    },
  },
  kn: {
    service: {
      subject: 'ಗ್ರಾಹಕರ ಮುಂದಿನ ಸರ್ವೀಸ್ ದಿನಾಂಕ — ತಾನಾಗಿಯೇ ನೆನಪು',
      line: 'ಒಂದು ಸಣ್ಣ ಪ್ರಶ್ನೆ: 3 ಅಥವಾ 6 ತಿಂಗಳ ನಂತರ ಪ್ರತಿ ಗ್ರಾಹಕರ ಮುಂದಿನ ಸರ್ವೀಸ್ ಯಾವಾಗ ಎಂಬುದನ್ನು ಹೇಗೆ ನೆನಪಿಡುತ್ತೀರಿ? ಅನೇಕ ಗ್ರಾಹಕರು ದಿನಾಂಕ ಮರೆತು ಬೇರೆಯವರನ್ನು ಕರೆಯುತ್ತಾರೆ.',
    },
    vehicle: {
      subject: 'ಮುಂದಿನ ವಾಹನ ಸರ್ವೀಸ್‌ಗೆ ಗ್ರಾಹಕರನ್ನು ಮತ್ತೆ ಕರೆತನ್ನಿ',
      line: 'ಒಂದು ಸಣ್ಣ ಪ್ರಶ್ನೆ: ಗ್ರಾಹಕರ ಕಾರು ಅಥವಾ ಬೈಕ್‌ಗೆ ಮುಂದಿನ ಸರ್ವೀಸ್ — 6 ತಿಂಗಳು ಅಥವಾ ಕೆಲವು ಸಾವಿರ ಕಿ.ಮೀ. ನಂತರ — ಬಂದಾಗ ಹೇಗೆ ನೆನಪಿಸುತ್ತೀರಿ? ಅನೇಕರು ಬೇರೆ ಗ್ಯಾರೇಜ್‌ಗೆ ಹೋಗುತ್ತಾರೆ.',
    },
    amc: {
      subject: 'AMC ನವೀಕರಣ ಮತ್ತು ನಿಗದಿತ ಭೇಟಿಗಳು — ರಿಜಿಸ್ಟರ್ ಇಲ್ಲದೆ',
      line: 'ಒಂದು ಸಣ್ಣ ಪ್ರಶ್ನೆ: AMC ನವೀಕರಣಗಳು ಮತ್ತು ಪ್ರತಿ ಒಪ್ಪಂದದ ನಿಗದಿತ ಭೇಟಿಗಳನ್ನು ಹೇಗೆ ಟ್ರ್ಯಾಕ್ ಮಾಡುತ್ತೀರಿ? ತಪ್ಪಿದ ನವೀಕರಣ ಸಾಮಾನ್ಯವಾಗಿ ಕಳೆದುಕೊಂಡ ಗ್ರಾಹಕ.',
    },
    pest: {
      subject: 'ತ್ರೈಮಾಸಿಕ ಟ್ರೀಟ್‌ಮೆಂಟ್ — ತಾನಾಗಿಯೇ ನೆನಪು',
      line: 'ಒಂದು ಸಣ್ಣ ಪ್ರಶ್ನೆ: ಯಾವ ಗ್ರಾಹಕರಿಗೆ ಮುಂದಿನ ಟ್ರೀಟ್‌ಮೆಂಟ್ — 3 ತಿಂಗಳಿಗೊಮ್ಮೆ ಅಥವಾ ವಾರ್ಷಿಕ ಗೆದ್ದಲು ತಪಾಸಣೆ — ಬರಬೇಕು ಎಂಬುದನ್ನು ಹೇಗೆ ನೆನಪಿಡುತ್ತೀರಿ? ಹೆಚ್ಚಿನವರು ತಾವಾಗಿಯೇ ಕರೆ ಮಾಡುವುದಿಲ್ಲ.',
    },
    solar: {
      subject: 'ಪ್ಯಾನೆಲ್ ಸ್ವಚ್ಛತೆ ಮತ್ತು ಬ್ಯಾಟರಿ ತಪಾಸಣೆ — ತಾನಾಗಿಯೇ ನೆನಪು',
      line: 'ಒಂದು ಸಣ್ಣ ಪ್ರಶ್ನೆ: ಸೋಲಾರ್ ಪ್ಯಾನೆಲ್ ಸ್ವಚ್ಛಗೊಳಿಸುವ ಅಥವಾ ಇನ್ವರ್ಟರ್ ಬ್ಯಾಟರಿ ಪರಿಶೀಲಿಸುವ ಸಮಯ ಬಂದಾಗ ಗ್ರಾಹಕರಿಗೆ ಹೇಗೆ ನೆನಪಿಸುತ್ತೀರಿ? ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ಮಾಡಿದರೆ ಇದು ನಿರಂತರ ಕೆಲಸ ತರುತ್ತದೆ.',
    },
    job: {
      subject: 'ಕೊಟೇಶನ್, GST ಬಿಲ್, ಮತ್ತೆ ಕೆಲಸ — ಫೋನ್‌ನಿಂದಲೇ',
      line: 'ಒಂದು ಸಣ್ಣ ಪ್ರಶ್ನೆ: ಈಗ ಗ್ರಾಹಕರಿಗೆ ಕೊಟೇಶನ್ ಮತ್ತು ಬಿಲ್ ಹೇಗೆ ಕಳುಹಿಸುತ್ತೀರಿ, ಹಳೆಯ ಗ್ರಾಹಕರು ಮುಂದಿನ ಕೆಲಸಕ್ಕೆ ನಿಮ್ಮನ್ನು ಮತ್ತೆ ಹೇಗೆ ಹುಡುಕುತ್ತಾರೆ?',
    },
  },
};

/** The shared email around {{tradeLine}}, per language. */
export const TRADE_BODIES: Record<string, string> = {
  en: `Hi Team,

{{tradeLine}}

Agla Kaam keeps track of when each customer's next visit is due and sends them a polite WhatsApp reminder before the date, so they book you again instead of someone else.

It also makes GST invoices and quotations and keeps every customer's history on your phone. Free to start: https://aglakaam.app/download

Would this be useful for your team?

Rajeev
Agla Kaam
support@aglakaam.app

If you'd rather not get these emails, unsubscribe here: {{unsubscribeUrl}}`,
  hi: `नमस्ते,

मैं राजीव, Agla Kaam से।

{{tradeLine}}

Agla Kaam हर ग्राहक की अगली विज़िट की तारीख याद रखता है और उससे पहले ग्राहक को WhatsApp पर विनम्र रिमाइंडर भेजता है, ताकि वह किसी और को नहीं, दोबारा आपको ही बुलाए।

साथ में GST बिल, कोटेशन और हर ग्राहक की पूरी हिस्ट्री भी फ़ोन पर। शुरुआत मुफ़्त है: https://aglakaam.app/download

क्या यह आपकी टीम के काम आएगा? बस इस ईमेल का जवाब दें।

राजीव
Agla Kaam
support@aglakaam.app

ये ईमेल नहीं चाहिए? यहाँ से बंद करें: {{unsubscribeUrl}}`,
  ml: `നമസ്കാരം,

ഞാൻ രാജീവ്, Agla Kaam-ൽ നിന്ന്.

{{tradeLine}}

Agla Kaam ഓരോ കസ്റ്റമറുടെയും അടുത്ത വിസിറ്റ് തീയതി ഓർത്തുവയ്ക്കുകയും, അതിന് മുൻപ് കസ്റ്റമർക്ക് WhatsApp-ൽ ഒരു ഓർമ്മപ്പെടുത്തൽ അയയ്ക്കുകയും ചെയ്യും, അവർ വേറെ ആരെയുമല്ല, വീണ്ടും നിങ്ങളെത്തന്നെ വിളിക്കാൻ.

GST ബില്ലും ക്വട്ടേഷനും ഓരോ കസ്റ്റമറുടെയും ഹിസ്റ്ററിയും ഫോണിൽ തന്നെ. തുടങ്ങാൻ സൗജന്യമാണ്: https://aglakaam.app/download

ഇത് നിങ്ങളുടെ ടീമിന് ഉപകാരപ്പെടുമോ? ഈ ഇമെയിലിന് മറുപടി അയച്ചാൽ മതി.

രാജീവ്
Agla Kaam
support@aglakaam.app

ഈ ഇമെയിലുകൾ വേണ്ടെങ്കിൽ: {{unsubscribeUrl}}`,
  ta: `வணக்கம்,

நான் ராஜீவ், Agla Kaam-இலிருந்து.

{{tradeLine}}

Agla Kaam ஒவ்வொரு வாடிக்கையாளரின் அடுத்த விசிட் தேதியை நினைவில் வைத்து, அதற்கு முன் வாடிக்கையாளருக்கு WhatsApp-இல் ஒரு நினைவூட்டல் அனுப்பும், அதனால் அவர்கள் வேறு யாரையும் அல்ல, மீண்டும் உங்களையே அழைப்பார்கள்.

GST பில், கொட்டேஷன் மற்றும் ஒவ்வொரு வாடிக்கையாளரின் வரலாறும் போனிலேயே. தொடங்குவது இலவசம்: https://aglakaam.app/download

இது உங்கள் குழுவுக்கு உதவுமா? இந்த மின்னஞ்சலுக்கு பதில் அனுப்பினால் போதும்.

ராஜீவ்
Agla Kaam
support@aglakaam.app

இந்த மின்னஞ்சல்கள் வேண்டாமெனில்: {{unsubscribeUrl}}`,
  kn: `ನಮಸ್ಕಾರ,

ನಾನು ರಾಜೀವ್, Agla Kaam-ನಿಂದ.

{{tradeLine}}

Agla Kaam ಪ್ರತಿ ಗ್ರಾಹಕರ ಮುಂದಿನ ಭೇಟಿಯ ದಿನಾಂಕವನ್ನು ನೆನಪಿಟ್ಟುಕೊಂಡು, ಅದಕ್ಕೂ ಮುನ್ನ ಗ್ರಾಹಕರಿಗೆ WhatsApp-ನಲ್ಲಿ ನೆನಪಿನ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತದೆ, ಆದ್ದರಿಂದ ಅವರು ಬೇರೆಯವರನ್ನಲ್ಲ, ಮತ್ತೆ ನಿಮ್ಮನ್ನೇ ಕರೆಯುತ್ತಾರೆ.

GST ಬಿಲ್, ಕೊಟೇಶನ್ ಮತ್ತು ಪ್ರತಿ ಗ್ರಾಹಕರ ಇತಿಹಾಸ ಫೋನ್‌ನಲ್ಲೇ. ಆರಂಭಿಸಲು ಉಚಿತ: https://aglakaam.app/download

ಇದು ನಿಮ್ಮ ತಂಡಕ್ಕೆ ಉಪಯೋಗವಾಗಬಹುದೇ? ಈ ಇಮೇಲ್‌ಗೆ ಉತ್ತರಿಸಿದರೆ ಸಾಕು.

ರಾಜೀವ್
Agla Kaam
support@aglakaam.app

ಈ ಇಮೇಲ್‌ಗಳು ಬೇಡವಾದರೆ: {{unsubscribeUrl}}`,
};

/** Subject and body for one kind of work, in one language. */
export function tradeEmail(language: string, kind: TradeKind, body: string, fallbackSubject: string) {
  // A body written without {{tradeLine}} is someone's own email: keep its subject too.
  if (!body.includes('{{tradeLine}}')) return { subject: fallbackSubject, body };
  const copy = TRADE_COPY[language]?.[kind] ?? TRADE_COPY.en[kind];
  return { subject: copy.subject, body: body.replace(/\{\{tradeLine\}\}/g, copy.line) };
}
