import type { LegalContent } from "./types";

/**
 * Legal texts in English. Translation of es.ts (the Spanish text is the reference version).
 * DRAFT: must be reviewed by a lawyer before publication. Keep es.ts, en.ts and zh.ts in sync and bump
 * LEGAL_LAST_UPDATED in ../legalConfig.ts whenever a text changes.
 */
const en: LegalContent = {
  updatedLabel: "Last updated",
  draftNotice:
    "Draft pending legal review. These texts describe how the service actually works, but they have not yet been validated by a legal professional.",
  placeholders: {
    name: "[Owner name — pending]",
    nif: "[Owner tax ID — pending]",
    address: "[Owner address — pending]",
    email: "[Contact email — pending]",
  },
  otherDocuments: "Other legal documents",
  docs: {
    // ---------------------------------------------------------------------------------------------------------
    legal: {
      title: "Legal Notice",
      sections: [
        {
          heading: "Owner identification",
          blocks: [
            {
              p: "In compliance with article 10 of Spanish Law 34/2002 on Information Society Services and Electronic Commerce (LSSI-CE), we inform you that the Mockia.io website (the \"Site\" or the \"Service\") is owned by:",
            },
            {
              ul: [
                "**Owner:** {entity.name}",
                "**Tax ID (NIF):** {entity.nif}",
                "**Address:** {entity.address}",
                "**Contact email:** [{entity.email}](mailto:{entity.email})",
                "**Registry details:** {entity.registry}",
              ],
            },
          ],
        },
        {
          heading: "Purpose and activity",
          blocks: [
            {
              p: "Mockia.io is an online service that generates and hosts mock APIs from public GitHub repositories and from the instructions the user writes, with the help of artificial intelligence. It offers a free plan and paid subscription plans; their conditions are in the [Terms of Service](/terms).",
            },
          ],
        },
        {
          heading: "Conditions of use of the Site",
          blocks: [
            {
              p: "Browsing the public pages of the Site is free. Use of the Service with an account is governed by the [Terms of Service](/terms). The user agrees to use the Site in accordance with the law, good faith and public order, and not to use it for unlawful purposes or in a way that infringes the rights of third parties.",
            },
          ],
        },
        {
          heading: "Intellectual and industrial property",
          blocks: [
            {
              p: "The code, design, texts, logos and other elements of the Site belong to {entity.name} or its licensors and are protected by intellectual and industrial property law. They may not be reproduced, distributed or modified without authorisation, except where the law expressly allows it.",
            },
            {
              p: "Content that the user provides and the results generated for the user are covered by the [Terms of Service](/terms).",
            },
          ],
        },
        {
          heading: "Liability",
          blocks: [
            {
              p: "The owner strives to keep the information and operation of the Site correct, but does not guarantee uninterrupted availability or the absence of errors. Content generated with artificial intelligence may be inaccurate. The owner is not liable for damage arising from misuse of the Site or, to the extent the law allows, from interruptions caused by maintenance, third-party failures or force majeure. None of this limits the rights that consumers cannot waive.",
            },
          ],
        },
        {
          heading: "Links to third parties",
          blocks: [
            {
              p: "The Site may link to third-party pages (for example GitHub or Stripe). The owner does not control those sites and is not responsible for their content or policies. If you become aware of unlawful content linked from the Site, please report it to [{entity.email}](mailto:{entity.email}).",
            },
          ],
        },
        {
          heading: "Data protection and cookies",
          blocks: [
            {
              p: "The processing of personal data is explained in the [Privacy Policy](/privacy), and the use of cookies and local storage in the [Cookie Policy](/cookies).",
            },
          ],
        },
        {
          heading: "Governing law and jurisdiction",
          blocks: [
            {
              p: "This Legal Notice is governed by Spanish law. For any dispute, the parties submit to the courts that are competent under the applicable rules; where the user is a consumer, these are the courts of the consumer's place of residence if the law so provides.",
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------------------------------------------------
    privacy: {
      title: "Privacy Policy",
      sections: [
        {
          heading: "Who is the controller",
          blocks: [
            {
              p: "This policy explains what personal data Mockia.io processes, why, on what legal basis, who else receives it and what rights you have, in accordance with Regulation (EU) 2016/679 (GDPR) and Spanish Organic Law 3/2018 (LOPDGDD). The data controller is:",
            },
            {
              ul: [
                "**Controller:** {entity.name}",
                "**Tax ID (NIF):** {entity.nif}",
                "**Address:** {entity.address}",
                "**Contact for privacy matters and to exercise your rights:** [{entity.email}](mailto:{entity.email})",
              ],
            },
          ],
        },
        {
          heading: "What data we process and where it comes from",
          blocks: [
            { p: "We only process the data the Service needs in order to work. This is everything we store:" },
            {
              table: {
                head: ["Category", "Data", "Source"],
                rows: [
                  [
                    "**Account**",
                    "Email, username, password (stored only as a bcrypt hash, never in plain text) and preferred interface language.",
                    "You, when you sign up and when you choose a language.",
                  ],
                  [
                    "**Session and security**",
                    "Active sessions (identifier, creation and expiry dates, IP address and browser or user-agent), the `mockia_rt` session cookie, and single-use links to verify your email or reset your password (only their fingerprint is stored, not the link). Server access logs (IP, date, requested path, browser).",
                    "Your browser, automatically.",
                  ],
                  [
                    "**Projects and content**",
                    "Name and description of your projects, the public GitHub repository URL, a structured summary extracted from that repository (names of types, interfaces, functions, routes and the main documentation), the endpoints, responses and sample data that are generated, and the instructions you write.",
                    "You, and the public repository you point to.",
                  ],
                  [
                    "**Billing**",
                    "Plan, subscription status, end date of the billing period, and Stripe customer and subscription identifiers. The payment and billing details you enter at checkout (card, name, address, tax ID if you provide one) are collected by Stripe: Mockia.io never sees or stores your card number.",
                    "You and Stripe.",
                  ],
                  [
                    "**Usage**",
                    "A monthly count of requests received by your mock APIs (just the number, to apply plan limits) and in-app notifications.",
                    "The Service itself.",
                  ],
                  [
                    "**Communications**",
                    "Messages you send us and the transactional emails we send you (verification, password recovery, payment notices).",
                    "You and the Service.",
                  ],
                ],
              },
            },
            {
              p: "We do not process special categories of data and we do not ask you to include any. Please do not include third parties' personal data or secrets (keys, passwords) in your instructions or in the repositories you connect.",
            },
          ],
        },
        {
          heading: "Why we process it and on what legal basis",
          blocks: [
            {
              table: {
                head: ["Purpose", "Legal basis (GDPR art. 6)"],
                rows: [
                  [
                    "Creating and managing your account, identifying you, sending the verification and password-recovery emails, and providing the Service (generating, hosting and serving your mock APIs).",
                    "Performance of a contract (art. 6.1.b): the Terms of Service.",
                  ],
                  [
                    "Charging subscriptions, issuing invoices, notifying you of failed payments and meeting accounting and tax obligations.",
                    "Performance of a contract (art. 6.1.b) and legal obligation (art. 6.1.c).",
                  ],
                  [
                    "Keeping the Service secure: limiting login attempts, detecting abuse and fraud, revoking compromised sessions and keeping access logs.",
                    "Legitimate interest (art. 6.1.f) in network and information security and in preventing abuse, which does not override your rights because it is limited to what is essential.",
                  ],
                  [
                    "Remembering your language and other interface preferences.",
                    "Performance of a contract (art. 6.1.b). This is necessary technical storage that you expressly request (see the [Cookie Policy](/cookies)).",
                  ],
                  [
                    "Handling your enquiries and the exercise of your rights, and defending claims.",
                    "Legal obligation (art. 6.1.c) and legitimate interest (art. 6.1.f).",
                  ],
                ],
              },
            },
            {
              p: "Today no processing is based on your consent and we send no marketing communications. If we add any in the future (for example analytics or advertising), we will ask first and you will be able to withdraw consent at any time.",
            },
            {
              p: "Providing the account data is necessary to use the Service: without it we cannot create the account.",
            },
          ],
        },
        {
          heading: "GitHub repositories: what we do and what we do not",
          blocks: [
            {
              p: "Mockia.io does not use GitHub sign-in and **does not store any GitHub token or credential**. It only works with public repositories: when you create or refresh a project, our server temporarily downloads the repository from its public URL, extracts the structure it needs (types, interfaces, functions, routes and the main documentation) and deletes the downloaded copy. We keep only that structured summary, which is deleted automatically 30 days after it is created.",
            },
          ],
        },
        {
          heading: "Artificial intelligence",
          blocks: [
            {
              p: "To generate endpoints we send an AI model provider (currently OpenRouter, which routes the request to a third-party model) the structured summary of the repository, the main documentation it contains and the instructions you write. We do not send your email, your password or your billing details. The provider applies its own data-use terms; see its privacy policy.",
            },
            {
              p: "In the future we may also offer a model hosted on our own infrastructure, in which case that data would not leave it; we will update this policy when that happens.",
            },
            {
              p: "We do not make decisions based solely on automated processing, including profiling, that produce legal effects concerning you or similarly significantly affect you (GDPR art. 22). AI is used to generate drafts of mock APIs, not to assess you. The automatic application of your plan limits, or the move to the free plan after a failed payment, is an objective contractual consequence that you can contest by writing to us.",
            },
          ],
        },
        {
          heading: "Who else receives your data",
          blocks: [
            {
              p: "We do not sell your data. We share it only with providers that supply us with services and act as processors under contract, and with authorities where the law requires it:",
            },
            {
              table: {
                head: ["Provider", "Purpose", "Data it receives"],
                rows: [
                  [
                    "**Stripe** (Stripe Payments Europe, Ltd. and Stripe, Inc.)",
                    "Processing payments and billing of subscriptions, and hosting the customer portal. Stripe also processes data as an independent controller to prevent fraud and comply with financial regulation ([Stripe privacy policy](https://stripe.com/privacy)).",
                    "Email, billing and payment details you enter, amounts and subscription status. Mockia.io does not receive your card number.",
                  ],
                  [
                    "**AI provider** (currently OpenRouter and the models it routes to)",
                    "Generating endpoints and sample data.",
                    "Structured summary of the public repository, main documentation and the instructions you write. Never your email, password or payment details.",
                  ],
                  [
                    "**Transactional email provider** (the SMTP service we contract)",
                    "Sending verification and password-recovery emails and payment notices.",
                    "Your email address and the content of the message, which includes a single-use link.",
                  ],
                  [
                    "**Hosting provider** (Render or other cloud infrastructure or our own server)",
                    "Hosting the application, the database and the server logs.",
                    "All the data described above, as infrastructure.",
                  ],
                  [
                    "**Google Fonts** (Google LLC)",
                    "The \"how it works\" animation on the home page loads typefaces from Google's servers, which receive your IP address when it opens.",
                    "Your IP address and the technical details of the browser request.",
                  ],
                ],
              },
            },
            {
              p: "GitHub receives from our server the download request for the public repositories you point to (with the server's IP address, not yours).",
            },
          ],
        },
        {
          heading: "International transfers",
          blocks: [
            {
              p: "Some of these providers (Stripe, the AI provider and the hosting provider) may process data outside the European Economic Area, in particular in the United States. In those cases the transfer relies on the European Commission's adequacy decision for the EU-US Data Privacy Framework where the provider has joined it and, failing that, on the Commission's standard contractual clauses (GDPR art. 46.2.c). You can ask us for more information at [{entity.email}](mailto:{entity.email}).",
            },
          ],
        },
        {
          heading: "How long we keep data",
          blocks: [
            {
              table: {
                head: ["Data", "Retention"],
                rows: [
                  [
                    "Account, projects and content",
                    "As long as you keep the account. If you delete it or ask us to erase it, we delete them, except as stated below.",
                  ],
                  ["Archived projects", "Permanently deleted 30 days after they are archived."],
                  ["Structured summary of a repository", "30 days from creation; then deleted automatically."],
                  [
                    "Sessions (including IP and browser)",
                    "Up to 7 days; they expire and are deleted automatically. They are also revoked when you log out or reset your password.",
                  ],
                  [
                    "Email verification and password-reset links",
                    "24 hours and 30 minutes respectively; then deleted automatically.",
                  ],
                  [
                    "Billing and tax data",
                    "For the applicable legal periods (commercial and tax obligations), duly blocked.",
                  ],
                  [
                    "Server access logs",
                    "For the limited period applied by the hosting provider and as needed for security.",
                  ],
                  [
                    "Enquiries and communications with you",
                    "As long as needed to handle them and, afterwards, during the limitation periods for possible liabilities.",
                  ],
                ],
              },
            },
          ],
        },
        {
          heading: "Your rights",
          blocks: [
            {
              p: "You can exercise at any time your rights of access, rectification, erasure, restriction of processing, portability and objection, and withdraw your consent where processing is based on it. To exercise them write to [{entity.email}](mailto:{entity.email}) stating the right you want to exercise; we may ask you to prove your identity. We reply within one month (extendable by two more months for complex requests, in which case we will tell you) and it is free of charge, except for manifestly unfounded or excessive requests.",
            },
            {
              p: "Some of it you can do yourself: change your language, log out or reset your password from the application.",
            },
            {
              p: "If you believe your data is not being processed properly, you have the right to lodge a complaint with the Spanish Data Protection Agency (AEPD): [www.aepd.es](https://www.aepd.es).",
            },
          ],
        },
        {
          heading: "Security",
          blocks: [
            {
              p: "We apply technical and organisational measures appropriate to the risk. They include: passwords are stored only as bcrypt hashes; verification and recovery links are single-use and stored only as a fingerprint; the session cookie is HttpOnly and cannot be read by page code; the Service is served over HTTPS in production; we limit login attempts; and payment data does not pass through our servers. No system is infallible: if a breach affecting your data occurs, we will notify you and the authority where the law requires it.",
            },
          ],
        },
        {
          heading: "Minimum age",
          blocks: [
            {
              p: "To use Mockia.io you must be at least 14 years old (LOPDGDD art. 7). If we find that an account belongs to someone under that age, we will delete it.",
            },
          ],
        },
        {
          heading: "Changes to this policy",
          blocks: [
            {
              p: "We may update this policy, for example if we change provider or add processing. We will publish the new version with its update date and, if the change is significant, let you know by email or in the application.",
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------------------------------------------------
    terms: {
      title: "Terms of Service",
      sections: [
        {
          heading: "Who we are and acceptance",
          blocks: [
            {
              p: "These Terms govern the use of Mockia.io, a service of {entity.name} (tax ID {entity.nif}), whose full details are in the [Legal Notice](/legal). By creating an account or using the Service you accept these Terms and the [Privacy Policy](/privacy). If you do not agree, do not use the Service.",
            },
            {
              p: "You must be at least 14 years old to use the Service and of legal age to purchase a paid plan.",
            },
          ],
        },
        {
          heading: "The Service",
          blocks: [
            {
              p: "Mockia.io generates, hosts and serves mock APIs for development and testing from public GitHub repositories and your instructions, with the help of artificial intelligence. It is not a production environment: you must not use it to serve real data or as the basis of a critical service.",
            },
          ],
        },
        {
          heading: "Your account",
          blocks: [
            {
              p: "You are responsible for keeping your account details truthful, for keeping your password secret and for everything that happens from your account. Tell us immediately if you suspect unauthorised access. To use AI generation and billing you may need to verify your email.",
            },
          ],
        },
        {
          heading: "Plans and prices",
          blocks: [
            {
              p: "We offer the Free, Pro and Team plans. Current prices, the limits of each plan (active projects and monthly requests) and, when available, annual billing are shown in the [pricing section](/) of the home page and are the ones that apply to your purchase at the time you make it. The Free plan is free of charge and may change or be withdrawn with notice.",
            },
            {
              p: "Prices are shown excluding taxes where applicable. VAT or other applicable taxes are calculated based on your country and shown at checkout before you confirm.",
            },
          ],
        },
        {
          heading: "Payment and automatic renewal",
          blocks: [
            {
              p: "Paid plans are monthly (and annual, when offered) subscriptions that **renew automatically** for equal periods until you cancel them. We charge at the start of each period to the payment method you provide. Payments are processed by Stripe; Mockia.io does not receive or store your card details. You will receive the invoice and can manage your payment method from the customer portal.",
            },
            {
              p: "If we change the price of a plan, we will notify you in reasonable time and before the next renewal; if you do not accept it, you can cancel before it applies.",
            },
          ],
        },
        {
          heading: "Cancellation",
          blocks: [
            {
              p: "You can cancel at any time from the customer portal, which you reach from the Billing page of your account. Cancellation takes effect at the end of the period already paid: until then you keep the plan, and afterwards you move to the Free plan with its limits. We do not delete your projects because you change plan.",
            },
            {
              p: "We do not refund the current period pro rata on cancellation, unless the law requires it.",
            },
          ],
        },
        {
          heading: "Failed payments",
          blocks: [
            {
              p: "If a charge fails, the subscription moves to the past-due state (past_due), we notify you by email and in the application, and Stripe retries the charge. You have a 7-day grace period to fix it while keeping your plan. If it is not fixed within that period, your account moves to the Free plan until the payment is resolved.",
            },
          ],
        },
        {
          heading: "Right of withdrawal",
          blocks: [
            {
              p: "If you are a consumer, you have the right to withdraw from the contract within 14 calendar days without giving a reason (Spanish Royal Legislative Decree 1/2007, TRLGDCU, art. 71 et seq.). To exercise it write to [{entity.email}](mailto:{entity.email}) stating your decision clearly.",
            },
            {
              p: "Because the Service is digital content made available to you immediately, before charging you we will ask you, through a checkbox in the checkout, to expressly request immediate access and to acknowledge that, once supply has begun, you lose the right of withdrawal under art. 103 TRLGDCU. Without that confirmation we cannot start the charge. If you withdraw within the period before supply has begun, we will refund the amount paid.",
            },
            { p: "This right does not apply if you contract as a professional or a business." },
          ],
        },
        {
          heading: "Acceptable use",
          blocks: [
            { p: "You agree not to use the Service for:" },
            {
              ul: [
                "Illegal activities, or to host or distribute unlawful, malicious or phishing content or malware.",
                "Harvesting data from the platform in an automated way (scraping) or probing it for vulnerabilities without authorisation.",
                "Exceeding or circumventing the usage limits and quotas of your plan, overloading the infrastructure, or launching denial-of-service attacks against or through the Service.",
                "Reselling access or impersonating another person.",
                "Connecting repositories you have no right to work with or whose licence does not allow it, or including real personal data of third parties in your mocks.",
              ],
            },
            {
              p: "Mock APIs have request and resource limits shown in your plan, and additional rate limits may apply to protect the Service. We may limit, block or suspend use that breaches this clause.",
            },
          ],
        },
        {
          heading: "Your content and generated output",
          blocks: [
            {
              p: "You keep all rights to your content (your instructions and the code and documentation of your repositories, which remain the property of whoever owns them). You grant us a limited, non-exclusive, worldwide licence solely to process it in order to provide the Service to you, which includes sending it to the AI provider as explained in the [Privacy Policy](/privacy).",
            },
            {
              p: "To the extent the law allows, the output generated for you (endpoints, responses and sample data) is yours and you may use it freely, including commercially. Other users may obtain similar output, and we do not guarantee that output is unique or free of third-party rights.",
            },
          ],
        },
        {
          heading: "AI output",
          blocks: [
            {
              p: "Output generated with artificial intelligence may be inaccurate, incomplete or unsuitable. Review it before using it and do not rely on it as the only basis for important decisions. Sample data is fictitious.",
            },
          ],
        },
        {
          heading: "Availability",
          blocks: [
            {
              p: "We strive to keep the Service available, but we do not guarantee that it will be uninterrupted or error-free. The Free plan is offered with no commitment on availability or support. Paid plans do not include a service level agreement (SLA) unless agreed in writing. We may perform maintenance and modify or withdraw features.",
            },
          ],
        },
        {
          heading: "Mockia.io intellectual property",
          blocks: [
            {
              p: "The Service, its software, design and trademarks belong to {entity.name} or its licensors. These Terms do not transfer any right in them to you other than the right to use them as set out here.",
            },
          ],
        },
        {
          heading: "Limitation of liability",
          blocks: [
            {
              p: "To the extent the law allows, we are not liable for indirect damage, loss of profit, loss of data or of opportunities arising from the use of, or inability to use, the Service. Where you are a professional or a business, our total liability is limited to what you have paid for the Service in the 12 months before the event giving rise to it.",
            },
            {
              p: "Nothing above excludes or limits liability that cannot lawfully be excluded or limited (for example for wilful misconduct or gross negligence) or the rights that the law grants consumers and that cannot be waived.",
            },
          ],
        },
        {
          heading: "Suspension and termination",
          blocks: [
            {
              p: "You may stop using the Service and delete your account whenever you want. We may suspend or close your account if you seriously or repeatedly breach these Terms, giving you notice unless there is an urgent risk. On termination we handle your data as described in the [Privacy Policy](/privacy).",
            },
          ],
        },
        {
          heading: "Changes to the Terms",
          blocks: [
            {
              p: "We may modify these Terms. We will notify you by email or in the application in reasonable time before substantial changes take effect. If you do not agree, you may cancel your subscription and stop using the Service; if you keep using it after that date, you accept the new version.",
            },
          ],
        },
        {
          heading: "Governing law and jurisdiction",
          blocks: [
            {
              p: "These Terms are governed by Spanish law. If you are a consumer, the mandatory consumer-protection rules of your country of residence also protect you and you may go to the courts of your place of residence. In all other cases, the parties submit to the courts that are competent under the applicable rules.",
            },
          ],
        },
        {
          heading: "Contact",
          blocks: [
            {
              p: "For any question about these Terms write to [{entity.email}](mailto:{entity.email}).",
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------------------------------------------------
    cookies: {
      title: "Cookie Policy",
      sections: [
        {
          heading: "What Mockia.io uses",
          blocks: [
            {
              p: "Mockia.io uses a single cookie and a few items in your browser's local storage. **All of them are strictly necessary** for the Service to work or to remember a choice you made. We use no analytics, advertising or tracking cookies, and no third-party cookies.",
            },
            {
              table: {
                head: ["Name", "Type", "Purpose", "Duration"],
                rows: [
                  [
                    "`mockia_rt`",
                    "First-party cookie, HttpOnly (page code cannot read it), SameSite, with the Secure attribute in production. Only sent to the authentication routes (`/api/auth`).",
                    "Keeping you logged in: it lets us renew access without asking for your password again.",
                    "Up to 7 days if you tick \"Remember me\"; otherwise it is a session cookie and disappears when you close the browser.",
                  ],
                  [
                    "`mockia_locale`",
                    "Local storage (localStorage).",
                    "Remembering the interface language you chose.",
                    "Until you delete it.",
                  ],
                  [
                    "`mockia_last_visited`",
                    "Local storage (localStorage).",
                    "Sorting your projects by the last one you opened in this browser.",
                    "Until you delete it.",
                  ],
                  [
                    "`mockia_verify_banner_dismissed`",
                    "Session storage (sessionStorage).",
                    "Remembering that you closed the email verification notice while the tab stays open.",
                    "Until you close the tab.",
                  ],
                ],
              },
            },
            {
              p: "The short-lived access token is kept only in the page's memory: it is stored neither in cookies nor in browser storage.",
            },
          ],
        },
        {
          heading: "Why we do not show a cookie banner",
          blocks: [
            {
              p: "Article 22.2 of the Spanish LSSI-CE requires prior consent for cookies and similar technologies, except those strictly necessary to provide a service the user has expressly requested (such as keeping the session or remembering the language). Since we only use that kind, we do not need to ask for your consent or show a banner.",
            },
            {
              p: "If in the future we add analytics, advertising or non-essential third-party content, we will ask for your consent before enabling them, with an option to reject that is as easy as the one to accept, and we will update this policy.",
            },
          ],
        },
        {
          heading: "Third-party services",
          blocks: [
            {
              p: "When you go to pay or manage your subscription, we take you to pages hosted by Stripe, which may use its own cookies according to its policy ([stripe.com/privacy](https://stripe.com/privacy)). Mockia.io does not control those cookies. In addition, the \"how it works\" animation on the home page downloads typefaces from Google Fonts, so Google receives your IP address; it does not set any Mockia.io cookies.",
            },
          ],
        },
        {
          heading: "How to delete or block them",
          blocks: [
            {
              p: "You can remove the cookie and the local data from your browser settings. If you delete `mockia_rt` you will be logged out; if you delete `mockia_locale` we will choose the language again from your browser. If you block the session cookie you will not be able to stay logged in.",
            },
            {
              p: "More information on how we handle your data is in the [Privacy Policy](/privacy).",
            },
          ],
        },
      ],
    },
  },
};

export default en;
