"use client";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
        
        <div className="space-y-6 text-gray-300">
          <section>
            <h2 className="text-xl font-semibold text-white mb-2">1. Introduction</h2>
            <p>
              This Privacy Policy describes how Recipe Automation Platform ("we", "us", or "our") 
              collects, uses, and shares information when you use our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">2. Information We Collect</h2>
            <p>We collect the following types of information:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong>Account Information:</strong> Email address, name, and password when you register</li>
              <li><strong>Pinterest Data:</strong> When you connect your Pinterest account, we access your boards and ability to create pins on your behalf</li>
              <li><strong>Content:</strong> Recipes, images, and designs you create within our platform</li>
              <li><strong>Usage Data:</strong> How you interact with our service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>To provide and maintain our service</li>
              <li>To publish pins to Pinterest on your behalf when you request</li>
              <li>To improve and personalize your experience</li>
              <li>To communicate with you about the service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">4. Pinterest Integration</h2>
            <p>
              When you connect your Pinterest account, we request access to:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Read your Pinterest boards</li>
              <li>Create pins on your boards</li>
              <li>Read your basic account information</li>
            </ul>
            <p className="mt-2">
              We only use this access to publish pins that you explicitly create and request to publish. 
              We do not access or store your Pinterest data for any other purpose.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">5. Data Security</h2>
            <p>
              We implement appropriate security measures to protect your information. 
              Pinterest access tokens are encrypted and stored securely.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">6. Data Sharing</h2>
            <p>
              We do not sell or share your personal information with third parties except:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>With Pinterest when you publish pins (as requested by you)</li>
              <li>To comply with legal obligations</li>
              <li>To protect our rights and safety</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">7. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Access your personal data</li>
              <li>Delete your account and data</li>
              <li>Disconnect your Pinterest account at any time</li>
              <li>Export your data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">8. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us at your support email.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes 
              by posting the new Privacy Policy on this page.
            </p>
          </section>

          <p className="text-sm text-gray-500 mt-8">
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}
