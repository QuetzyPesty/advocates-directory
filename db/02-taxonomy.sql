-- ============================================================================
-- Reference data: courts, practice areas, institutions, bar councils,
-- languages, relationship types, saved screens.
--
-- This is the India-specific layer. Swap this file to port the structure to
-- another jurisdiction; 01-schema.sql stays unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Languages
-- ---------------------------------------------------------------------------
INSERT INTO language (code, name) VALUES
 ('en','English'),('hi','Hindi'),('bn','Bengali'),('mr','Marathi'),('te','Telugu'),
 ('ta','Tamil'),('gu','Gujarati'),('ur','Urdu'),('kn','Kannada'),('ml','Malayalam'),
 ('or','Odia'),('pa','Punjabi'),('as','Assamese'),('ks','Kashmiri'),('sd','Sindhi'),
 ('ne','Nepali'),('kok','Konkani'),('mni','Manipuri'),('sa','Sanskrit'),('fr','French');

-- ---------------------------------------------------------------------------
-- Bar Councils
-- ---------------------------------------------------------------------------
INSERT INTO bar_council (slug, name, state, code) VALUES
 ('bci','Bar Council of India',NULL,'BCI'),
 ('bcd','Bar Council of Delhi','Delhi','D'),
 ('bcmg','Bar Council of Maharashtra & Goa','Maharashtra','MAH'),
 ('bctp','Bar Council of Tamil Nadu & Puducherry','Tamil Nadu','TN'),
 ('bck','Bar Council of Karnataka','Karnataka','KAR'),
 ('bcwb','Bar Council of West Bengal','West Bengal','WB'),
 ('bcup','Bar Council of Uttar Pradesh','Uttar Pradesh','UP'),
 ('bcap','Bar Council of Andhra Pradesh','Andhra Pradesh','AP'),
 ('bcts','Bar Council of Telangana','Telangana','TS'),
 ('bcguj','Bar Council of Gujarat','Gujarat','GUJ'),
 ('bcker','Bar Council of Kerala','Kerala','KER'),
 ('bcph','Bar Council of Punjab & Haryana','Punjab','P/H'),
 ('bcraj','Bar Council of Rajasthan','Rajasthan','RAJ'),
 ('bcmp','Bar Council of Madhya Pradesh','Madhya Pradesh','MP'),
 ('bcodi','Bar Council of Odisha','Odisha','ODI'),
 ('bcas','Bar Council of Assam, Nagaland, Mizoram, Arunachal Pradesh & Sikkim','Assam','ASM'),
 ('bcbih','Bar Council of Bihar','Bihar','BIH'),
 ('bcjh','Bar Council of Jharkhand','Jharkhand','JHK'),
 ('bcch','Bar Council of Chhattisgarh','Chhattisgarh','CHT'),
 ('bcuk','Bar Council of Uttarakhand','Uttarakhand','UK'),
 ('bchp','Bar Council of Himachal Pradesh','Himachal Pradesh','HP'),
 ('bcjk','Bar Council of Jammu & Kashmir and Ladakh','Jammu & Kashmir','J&K');

-- ---------------------------------------------------------------------------
-- Courts & forums
-- ---------------------------------------------------------------------------
INSERT INTO court (slug, name, short_name, court_type, city, state, requires_aor, sort_order, jurisdiction_note) VALUES
 ('supreme-court-of-india','Supreme Court of India','SC','supreme','New Delhi','Delhi',1,1,
  'Filing requires an Advocate-on-Record. Senior Advocates argue on instruction from an AoR.'),

 -- High Courts
 ('delhi-hc','High Court of Delhi','Delhi HC','high_court','New Delhi','Delhi',0,10,NULL),
 ('bombay-hc','High Court of Judicature at Bombay','Bombay HC','high_court','Mumbai','Maharashtra',0,10,NULL),
 ('madras-hc','High Court of Judicature at Madras','Madras HC','high_court','Chennai','Tamil Nadu',0,10,NULL),
 ('calcutta-hc','High Court at Calcutta','Calcutta HC','high_court','Kolkata','West Bengal',0,10,NULL),
 ('karnataka-hc','High Court of Karnataka','Karnataka HC','high_court','Bengaluru','Karnataka',0,10,NULL),
 ('allahabad-hc','High Court of Judicature at Allahabad','Allahabad HC','high_court','Prayagraj','Uttar Pradesh',0,10,NULL),
 ('gujarat-hc','High Court of Gujarat','Gujarat HC','high_court','Ahmedabad','Gujarat',0,10,NULL),
 ('kerala-hc','High Court of Kerala','Kerala HC','high_court','Kochi','Kerala',0,10,NULL),
 ('telangana-hc','High Court for the State of Telangana','Telangana HC','high_court','Hyderabad','Telangana',0,10,NULL),
 ('ap-hc','High Court of Andhra Pradesh','AP HC','high_court','Amaravati','Andhra Pradesh',0,10,NULL),
 ('punjab-haryana-hc','High Court of Punjab & Haryana','P&H HC','high_court','Chandigarh','Punjab',0,10,NULL),
 ('rajasthan-hc','High Court of Rajasthan','Rajasthan HC','high_court','Jodhpur','Rajasthan',0,10,NULL),
 ('mp-hc','High Court of Madhya Pradesh','MP HC','high_court','Jabalpur','Madhya Pradesh',0,10,NULL),
 ('patna-hc','High Court of Patna','Patna HC','high_court','Patna','Bihar',0,10,NULL),
 ('orissa-hc','High Court of Orissa','Orissa HC','high_court','Cuttack','Odisha',0,10,NULL),
 ('gauhati-hc','Gauhati High Court','Gauhati HC','high_court','Guwahati','Assam',0,10,NULL),
 ('jharkhand-hc','High Court of Jharkhand','Jharkhand HC','high_court','Ranchi','Jharkhand',0,10,NULL),
 ('chhattisgarh-hc','High Court of Chhattisgarh','Chhattisgarh HC','high_court','Bilaspur','Chhattisgarh',0,10,NULL),
 ('uttarakhand-hc','High Court of Uttarakhand','Uttarakhand HC','high_court','Nainital','Uttarakhand',0,10,NULL),
 ('himachal-hc','High Court of Himachal Pradesh','HP HC','high_court','Shimla','Himachal Pradesh',0,10,NULL),
 ('jk-hc','High Court of Jammu & Kashmir and Ladakh','J&K HC','high_court','Srinagar','Jammu & Kashmir',0,10,NULL),
 ('manipur-hc','High Court of Manipur','Manipur HC','high_court','Imphal','Manipur',0,10,NULL),
 ('meghalaya-hc','High Court of Meghalaya','Meghalaya HC','high_court','Shillong','Meghalaya',0,10,NULL),
 ('tripura-hc','High Court of Tripura','Tripura HC','high_court','Agartala','Tripura',0,10,NULL),
 ('sikkim-hc','High Court of Sikkim','Sikkim HC','high_court','Gangtok','Sikkim',0,10,NULL),

 -- Tribunals & commissions
 ('nclt','National Company Law Tribunal','NCLT','tribunal',NULL,NULL,0,20,'Insolvency, oppression & mismanagement, corporate restructuring.'),
 ('nclat','National Company Law Appellate Tribunal','NCLAT','tribunal','New Delhi','Delhi',0,20,NULL),
 ('ngt','National Green Tribunal','NGT','tribunal','New Delhi','Delhi',0,20,'Environmental claims.'),
 ('itat','Income Tax Appellate Tribunal','ITAT','tribunal',NULL,NULL,0,20,NULL),
 ('cestat','Customs, Excise & Service Tax Appellate Tribunal','CESTAT','tribunal',NULL,NULL,0,20,NULL),
 ('drt','Debts Recovery Tribunal','DRT','tribunal',NULL,NULL,0,20,NULL),
 ('drat','Debts Recovery Appellate Tribunal','DRAT','tribunal',NULL,NULL,0,20,NULL),
 ('tdsat','Telecom Disputes Settlement & Appellate Tribunal','TDSAT','tribunal','New Delhi','Delhi',0,20,NULL),
 ('sat','Securities Appellate Tribunal','SAT','tribunal','Mumbai','Maharashtra',0,20,NULL),
 ('cat','Central Administrative Tribunal','CAT','tribunal',NULL,NULL,0,20,'Central government service matters.'),
 ('aft','Armed Forces Tribunal','AFT','tribunal',NULL,NULL,0,20,NULL),
 ('appellate-tribunal-electricity','Appellate Tribunal for Electricity','APTEL','tribunal','New Delhi','Delhi',0,20,NULL),
 ('ncdrc','National Consumer Disputes Redressal Commission','NCDRC','consumer','New Delhi','Delhi',0,25,NULL),
 ('state-consumer-commission','State Consumer Disputes Redressal Commission','SCDRC','consumer',NULL,NULL,0,25,NULL),
 ('district-consumer-forum','District Consumer Disputes Redressal Commission','DCDRC','consumer',NULL,NULL,0,25,NULL),
 ('cci','Competition Commission of India','CCI','regulator','New Delhi','Delhi',0,30,NULL),
 ('sebi','Securities and Exchange Board of India','SEBI','regulator','Mumbai','Maharashtra',0,30,NULL),
 ('nhrc','National Human Rights Commission','NHRC','commission','New Delhi','Delhi',0,30,NULL),

 -- Trial courts and specialised forums
 ('district-court','District & Sessions Court','District Court','district',NULL,NULL,0,40,'Civil suits and criminal trials at first instance.'),
 ('family-court','Family Court','Family Court','family',NULL,NULL,0,40,'Divorce, maintenance, custody, guardianship.'),
 ('labour-court','Labour Court / Industrial Tribunal','Labour Court','labour',NULL,NULL,0,40,NULL),
 ('rent-tribunal','Rent Controller / Rent Tribunal','Rent Tribunal','revenue',NULL,NULL,0,40,NULL),
 ('metropolitan-magistrate','Court of the Metropolitan Magistrate','MM Court','sessions',NULL,NULL,0,40,'Cheque bouncing, summons trials, bail at first instance.'),

 -- Arbitration
 ('domestic-arbitration','Domestic Arbitration (ad hoc)','Arbitration','arbitral',NULL,NULL,0,50,NULL),
 ('mcia','Mumbai Centre for International Arbitration','MCIA','arbitral','Mumbai','Maharashtra',0,50,NULL),
 ('diac','Delhi International Arbitration Centre','DIAC','arbitral','New Delhi','Delhi',0,50,NULL),
 ('iiac','India International Arbitration Centre','IIAC','arbitral','New Delhi','Delhi',0,50,NULL),
 ('siac','Singapore International Arbitration Centre','SIAC','arbitral','Singapore',NULL,0,50,NULL),
 ('lcia','London Court of International Arbitration','LCIA','arbitral','London',NULL,0,50,NULL);

-- High Court benches
INSERT INTO court (slug, name, short_name, court_type, parent_id, city, state, sort_order)
SELECT 'bombay-hc-nagpur','Bombay High Court, Nagpur Bench','Bombay HC (Nagpur)','high_court_bench',id,'Nagpur','Maharashtra',11 FROM court WHERE slug='bombay-hc';
INSERT INTO court (slug, name, short_name, court_type, parent_id, city, state, sort_order)
SELECT 'bombay-hc-goa','Bombay High Court at Goa','Bombay HC (Goa)','high_court_bench',id,'Panaji','Goa',11 FROM court WHERE slug='bombay-hc';
INSERT INTO court (slug, name, short_name, court_type, parent_id, city, state, sort_order)
SELECT 'madras-hc-madurai','Madras High Court, Madurai Bench','Madras HC (Madurai)','high_court_bench',id,'Madurai','Tamil Nadu',11 FROM court WHERE slug='madras-hc';
INSERT INTO court (slug, name, short_name, court_type, parent_id, city, state, sort_order)
SELECT 'allahabad-hc-lucknow','Allahabad High Court, Lucknow Bench','Allahabad HC (Lucknow)','high_court_bench',id,'Lucknow','Uttar Pradesh',11 FROM court WHERE slug='allahabad-hc';
INSERT INTO court (slug, name, short_name, court_type, parent_id, city, state, sort_order)
SELECT 'rajasthan-hc-jaipur','Rajasthan High Court, Jaipur Bench','Rajasthan HC (Jaipur)','high_court_bench',id,'Jaipur','Rajasthan',11 FROM court WHERE slug='rajasthan-hc';
INSERT INTO court (slug, name, short_name, court_type, parent_id, city, state, sort_order)
SELECT 'mp-hc-indore','MP High Court, Indore Bench','MP HC (Indore)','high_court_bench',id,'Indore','Madhya Pradesh',11 FROM court WHERE slug='mp-hc';

-- ---------------------------------------------------------------------------
-- Practice areas (two levels, parent -> sub-area)
-- ---------------------------------------------------------------------------
INSERT INTO practice_area (slug, name, sort_order, description) VALUES
 ('constitutional','Constitutional & Public Law',10,'Fundamental rights, judicial review, writs, federalism.'),
 ('criminal','Criminal Law',20,'Investigation, trial, bail, appeals, economic offences.'),
 ('commercial','Commercial & Corporate',30,'Contracts, companies, insolvency, competition, securities.'),
 ('dispute-resolution','Dispute Resolution',40,'Civil litigation, arbitration, mediation, enforcement.'),
 ('family-personal','Family & Personal Law',50,'Marriage, succession, guardianship, maintenance.'),
 ('property-real-estate','Property & Real Estate',60,'Title, tenancy, land acquisition, RERA.'),
 ('employment-service','Employment & Service Law',70,'Industrial disputes, government service, employment contracts.'),
 ('tax','Taxation',80,'Direct tax, indirect tax, transfer pricing, customs.'),
 ('ip-technology','IP & Technology',90,'Patents, trade marks, copyright, data protection, media.'),
 ('regulatory','Regulatory & Sectoral',100,'Energy, telecom, environment, banking, healthcare regulation.'),
 ('human-rights','Human Rights & Public Interest',110,'PIL, civil liberties, prisoners rights, environment justice.'),
 ('international','International & Cross-border',120,'Private international law, treaty arbitration, extradition.');

-- Sub-areas
INSERT INTO practice_area (slug, name, parent_id, sort_order)
SELECT * FROM (
  SELECT 'writ-petitions' AS slug,'Writ Petitions' AS name,(SELECT id FROM practice_area WHERE slug='constitutional') AS p,11 AS s
  UNION ALL SELECT 'election-law','Election Law',(SELECT id FROM practice_area WHERE slug='constitutional'),12
  UNION ALL SELECT 'service-constitutional','Service Matters (Constitutional)',(SELECT id FROM practice_area WHERE slug='constitutional'),13

  UNION ALL SELECT 'criminal-trial','Criminal Trial & Bail',(SELECT id FROM practice_area WHERE slug='criminal'),21
  UNION ALL SELECT 'economic-offences','Economic Offences',(SELECT id FROM practice_area WHERE slug='criminal'),22
  UNION ALL SELECT 'cheque-bouncing','Cheque Dishonour (S.138 NI Act)',(SELECT id FROM practice_area WHERE slug='criminal'),23
  UNION ALL SELECT 'white-collar','White Collar & Corporate Crime',(SELECT id FROM practice_area WHERE slug='criminal'),24

  UNION ALL SELECT 'company-law','Company Law',(SELECT id FROM practice_area WHERE slug='commercial'),31
  UNION ALL SELECT 'insolvency','Insolvency & Bankruptcy',(SELECT id FROM practice_area WHERE slug='commercial'),32
  UNION ALL SELECT 'competition-law','Competition Law',(SELECT id FROM practice_area WHERE slug='commercial'),33
  UNION ALL SELECT 'securities-law','Securities & Capital Markets',(SELECT id FROM practice_area WHERE slug='commercial'),34
  UNION ALL SELECT 'banking-finance','Banking & Finance',(SELECT id FROM practice_area WHERE slug='commercial'),35
  UNION ALL SELECT 'ma-transactions','M&A and Transactions',(SELECT id FROM practice_area WHERE slug='commercial'),36
  UNION ALL SELECT 'private-equity-vc','Private Equity & Venture Capital',(SELECT id FROM practice_area WHERE slug='commercial'),37

  UNION ALL SELECT 'civil-litigation','Civil Litigation',(SELECT id FROM practice_area WHERE slug='dispute-resolution'),41
  UNION ALL SELECT 'arbitration','Arbitration',(SELECT id FROM practice_area WHERE slug='dispute-resolution'),42
  UNION ALL SELECT 'consumer','Consumer Disputes',(SELECT id FROM practice_area WHERE slug='dispute-resolution'),43
  UNION ALL SELECT 'mediation','Mediation & Settlement',(SELECT id FROM practice_area WHERE slug='dispute-resolution'),44
  UNION ALL SELECT 'enforcement','Execution & Enforcement',(SELECT id FROM practice_area WHERE slug='dispute-resolution'),45

  UNION ALL SELECT 'matrimonial','Divorce & Matrimonial',(SELECT id FROM practice_area WHERE slug='family-personal'),51
  UNION ALL SELECT 'maintenance-custody','Maintenance & Child Custody',(SELECT id FROM practice_area WHERE slug='family-personal'),52
  UNION ALL SELECT 'succession','Succession, Wills & Probate',(SELECT id FROM practice_area WHERE slug='family-personal'),53
  UNION ALL SELECT 'domestic-violence','Domestic Violence',(SELECT id FROM practice_area WHERE slug='family-personal'),54

  UNION ALL SELECT 'title-disputes','Title & Partition Disputes',(SELECT id FROM practice_area WHERE slug='property-real-estate'),61
  UNION ALL SELECT 'landlord-tenant','Landlord & Tenant',(SELECT id FROM practice_area WHERE slug='property-real-estate'),62
  UNION ALL SELECT 'land-acquisition','Land Acquisition',(SELECT id FROM practice_area WHERE slug='property-real-estate'),63
  UNION ALL SELECT 'rera','RERA & Real Estate Regulation',(SELECT id FROM practice_area WHERE slug='property-real-estate'),64

  UNION ALL SELECT 'industrial-disputes','Industrial & Labour Disputes',(SELECT id FROM practice_area WHERE slug='employment-service'),71
  UNION ALL SELECT 'government-service','Government Service Law',(SELECT id FROM practice_area WHERE slug='employment-service'),72
  UNION ALL SELECT 'employment-advisory','Employment Advisory & POSH',(SELECT id FROM practice_area WHERE slug='employment-service'),73

  UNION ALL SELECT 'direct-tax','Direct Tax',(SELECT id FROM practice_area WHERE slug='tax'),81
  UNION ALL SELECT 'gst-indirect','GST & Indirect Tax',(SELECT id FROM practice_area WHERE slug='tax'),82
  UNION ALL SELECT 'transfer-pricing','Transfer Pricing',(SELECT id FROM practice_area WHERE slug='tax'),83

  UNION ALL SELECT 'trade-marks','Trade Marks & Passing Off',(SELECT id FROM practice_area WHERE slug='ip-technology'),91
  UNION ALL SELECT 'patents','Patents',(SELECT id FROM practice_area WHERE slug='ip-technology'),92
  UNION ALL SELECT 'copyright-media','Copyright & Media',(SELECT id FROM practice_area WHERE slug='ip-technology'),93
  UNION ALL SELECT 'data-protection','Data Protection & Privacy',(SELECT id FROM practice_area WHERE slug='ip-technology'),94
  UNION ALL SELECT 'technology-law','Technology & Cyber Law',(SELECT id FROM practice_area WHERE slug='ip-technology'),95

  UNION ALL SELECT 'energy-infrastructure','Energy & Infrastructure',(SELECT id FROM practice_area WHERE slug='regulatory'),101
  UNION ALL SELECT 'environment','Environment',(SELECT id FROM practice_area WHERE slug='regulatory'),102
  UNION ALL SELECT 'telecom-media-regulatory','Telecom & Broadcasting',(SELECT id FROM practice_area WHERE slug='regulatory'),103
  UNION ALL SELECT 'healthcare-pharma','Healthcare & Pharma',(SELECT id FROM practice_area WHERE slug='regulatory'),104

  UNION ALL SELECT 'public-interest','Public Interest Litigation',(SELECT id FROM practice_area WHERE slug='human-rights'),111
  UNION ALL SELECT 'civil-liberties','Civil Liberties',(SELECT id FROM practice_area WHERE slug='human-rights'),112
  UNION ALL SELECT 'legal-aid','Legal Aid & Access to Justice',(SELECT id FROM practice_area WHERE slug='human-rights'),113

  UNION ALL SELECT 'international-arbitration','International Arbitration',(SELECT id FROM practice_area WHERE slug='international'),121
  UNION ALL SELECT 'cross-border-disputes','Cross-border Disputes',(SELECT id FROM practice_area WHERE slug='international'),122
  UNION ALL SELECT 'extradition-mlat','Extradition & Mutual Legal Assistance',(SELECT id FROM practice_area WHERE slug='international'),123
);

-- ---------------------------------------------------------------------------
-- Institutions
-- ---------------------------------------------------------------------------
INSERT INTO institution (slug, name, short_name, type, city, state) VALUES
 ('nls-bengaluru','National Law School of India University','NLSIU','law_school','Bengaluru','Karnataka'),
 ('nalsar','NALSAR University of Law','NALSAR','law_school','Hyderabad','Telangana'),
 ('nlu-delhi','National Law University, Delhi','NLU Delhi','law_school','New Delhi','Delhi'),
 ('nliu-bhopal','National Law Institute University','NLIU','law_school','Bhopal','Madhya Pradesh'),
 ('wbnujs','West Bengal National University of Juridical Sciences','NUJS','law_school','Kolkata','West Bengal'),
 ('gnlu','Gujarat National Law University','GNLU','law_school','Gandhinagar','Gujarat'),
 ('nlu-jodhpur','National Law University, Jodhpur','NLU Jodhpur','law_school','Jodhpur','Rajasthan'),
 ('hnlu','Hidayatullah National Law University','HNLU','law_school','Raipur','Chhattisgarh'),
 ('rmlnlu','Dr. Ram Manohar Lohiya National Law University','RMLNLU','law_school','Lucknow','Uttar Pradesh'),
 ('mnlu-mumbai','Maharashtra National Law University, Mumbai','MNLU Mumbai','law_school','Mumbai','Maharashtra'),
 ('faculty-of-law-du','Faculty of Law, University of Delhi','Law Faculty, DU','law_school','New Delhi','Delhi'),
 ('campus-law-centre','Campus Law Centre, University of Delhi','CLC','law_school','New Delhi','Delhi'),
 ('ils-pune','ILS Law College','ILS Pune','law_school','Pune','Maharashtra'),
 ('government-law-college-mumbai','Government Law College','GLC Mumbai','law_school','Mumbai','Maharashtra'),
 ('symbiosis-pune','Symbiosis Law School','SLS Pune','law_school','Pune','Maharashtra'),
 ('jindal-global-law','Jindal Global Law School','JGLS','law_school','Sonipat','Haryana'),
 ('nujs-alt','School of Law, Christ University','Christ','law_school','Bengaluru','Karnataka'),
 ('madras-law-college','Dr. Ambedkar Government Law College','Madras Law College','law_school','Chennai','Tamil Nadu'),
 ('oxford','University of Oxford','Oxford','university','Oxford',NULL),
 ('cambridge','University of Cambridge','Cambridge','university','Cambridge',NULL),
 ('harvard-law','Harvard Law School','HLS','university','Cambridge, MA',NULL),
 ('lse','London School of Economics','LSE','university','London',NULL),
 ('columbia-law','Columbia Law School','Columbia','university','New York',NULL),
 ('nyu-law','New York University School of Law','NYU','university','New York',NULL);

-- ---------------------------------------------------------------------------
-- Relationship types — the vocabulary of the graph
-- ---------------------------------------------------------------------------
INSERT INTO relationship_type (code, label, inverse_code, symmetric, category, description) VALUES
 ('chamber_junior_of','Junior in the chamber of','mentor_of',0,'chamber',
   'Currently working as a junior in this advocate''s chamber.'),
 ('mentor_of','Has as a chamber junior','chamber_junior_of',0,'chamber',NULL),
 ('former_chamber_junior_of','Former junior in the chamber of','former_mentor_of',0,'chamber',
   'The single most useful edge in the Indian Bar: chambers are the lineage.'),
 ('former_mentor_of','Former chamber junior','former_chamber_junior_of',0,'chamber',NULL),
 ('co_junior_with','Co-junior in the same chamber',NULL,1,'chamber',
   'Juniored in the same chamber, overlapping years.'),
 ('successor_in_chamber_of','Took over the chamber of','predecessor_in_chamber_of',0,'chamber',NULL),
 ('predecessor_in_chamber_of','Chamber taken over by','successor_in_chamber_of',0,'chamber',NULL),

 ('partner_of','Partner with',NULL,1,'firm','Partners in the same firm.'),
 ('colleague_of','Colleague at',NULL,1,'firm','Worked at the same firm, overlapping.'),
 ('founded_with','Co-founded practice with',NULL,1,'firm',NULL),

 ('taught_by','Taught by','taught',0,'education',NULL),
 ('taught','Taught','taught_by',0,'education',NULL),
 ('classmate_of','Classmate of',NULL,1,'education','Same institution, same cohort.'),
 ('alumnus_peer_of','Alumnus peer of',NULL,1,'education',
   'Same institution, different years. Weak tie — usually derived, not entered.'),
 ('moot_partner_of','Mooted with',NULL,1,'education',NULL),

 ('law_clerk_to','Law clerk to','had_law_clerk',0,'court',NULL),
 ('had_law_clerk','Had as law clerk','law_clerk_to',0,'court',NULL),
 ('briefs','Briefs / instructs','briefed_by',0,'professional',
   'An AoR or instructing counsel who regularly briefs this advocate.'),
 ('briefed_by','Briefed by','briefs',0,'professional',NULL),
 ('leads','Leads as senior counsel','led_by',0,'professional',
   'Appears as senior counsel with this advocate junioring.'),
 ('led_by','Juniors to','leads',0,'professional',NULL),
 ('co_counsel_with','Appeared as co-counsel with',NULL,1,'professional',NULL),
 ('opposed','Regularly opposed in court',NULL,1,'professional',NULL),
 ('relative_of','Related to',NULL,1,'family',
   'Generic tie, for when the exact relation is unknown or not worth pinning down.'),
 ('spouse_of','Spouse of',NULL,1,'family','Marriage or an equivalent partnership.'),
 ('parent_of','Parent of','child_of',0,'family',NULL),
 ('child_of','Child of','parent_of',0,'family',NULL),
 ('sibling_of','Sibling of',NULL,1,'family',NULL),
 ('grandparent_of','Grandparent of','grandchild_of',0,'family',NULL),
 ('grandchild_of','Grandchild of','grandparent_of',0,'family',NULL),
 ('uncle_aunt_of','Uncle or aunt of','nephew_niece_of',0,'family',NULL),
 ('nephew_niece_of','Nephew or niece of','uncle_aunt_of',0,'family',NULL),
 ('cousin_of','Cousin of',NULL,1,'family',NULL),
 ('in_law_of','Related by marriage to',NULL,1,'family',
   'Parent-in-law, sibling-in-law and so on. Put the exact relation in the note.');

-- ---------------------------------------------------------------------------
-- Saved screens — one per audience, proving the engine is shared
-- ---------------------------------------------------------------------------
INSERT INTO saved_screen (slug, name, audience, description, filters) VALUES
 ('sc-constitutional-seniors','Senior Advocates in constitutional law at the Supreme Court','lawyer',
  'Who to consider briefing in a constitutional matter before the Supreme Court.',
  '{"designation":["senior_advocate","senior_advocate_aor"],"courts":["supreme-court-of-india"],"practice_areas":["constitutional"],"sort":"experience_desc"}'),

 ('delhi-interns','Chambers in Delhi taking interns','student',
  'Delhi-based advocates who have said they take interns.',
  '{"accepts_interns":true,"city":"New Delhi","sort":"experience_desc"}'),

 ('arbitration-mid-career','Mid-career arbitration counsel','lawyer',
  '8 to 20 years at the Bar, arbitration as a primary area.',
  '{"practice_areas":["arbitration","international-arbitration"],"practice_area_mode":"any","min_years":8,"max_years":20,"sort":"experience_asc"}'),

 ('direct-brief-family-mumbai','Family law, Mumbai, accepts direct briefs','litigant',
  'Family law practitioners in Mumbai who take instructions directly.',
  '{"practice_areas":["family-personal"],"city":"Mumbai","accepts_direct_briefs":true,"sort":"experience_desc"}'),

 ('recently-noted','Recently annotated','admin',
  'Everyone I have written a note about, most recent first.',
  '{"has_notes":true,"sort":"recently_updated"}'),

 ('needs-detail','Thin entries','admin',
  'Records with no practice area recorded yet.',
  '{"missing":"practice_areas","sort":"name_asc"}'),

 ('legal-aid-panel','Legal aid and pro bono','litigant',
  'Advocates on legal aid panels or who take pro bono matters.',
  '{"legal_aid_panel":true,"sort":"name_asc"}'),

 ('unverified-backlog','Unverified entries','admin',
  'Records that still need a source or a claim.',
  '{"verification_status":["unverified"],"sort":"name_asc"}');
