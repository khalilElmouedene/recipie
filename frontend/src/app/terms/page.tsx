"use client";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
        
        <div className="space-y-6 text-gray-300">
          <section>
            <h2 className="text-xl font-semibold text-white mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing and using Recipe Automation Platform, you agree to be bound by these 
              Terms of Service and our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">2. Description of Service</h2>
            <p>
              Recipe Automation Platform provides tools for creating, managing, and publishing 
              recipe content including:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Recipe content management</li>
              <li>Pinterest pin design and publishing</li>
              <li>WordPress integration</li>
              <li>Image generation</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">3. User Accounts</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials 
              and for all activities that occur under your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">4. Pinterest Integration</h2>
            <p>
              When you connect your Pinterest account to our service:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>You authorize us to access your Pinterest account as described in our Privacy Policy</li>
              <li>You agree to comply with Pinterest's Terms of Service</li>
              <li>You are responsible for the content you publish to Pinterest through our service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">5. User Content</h2>
            <p>
              You retain ownership of content you create. By using our service, you grant us 
              a license to process your content as necessary to provide the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">6. Prohibited Uses</h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Violate any laws or regulations</li>
              <li>Infringe on intellectual property rights</li>
              <li>Upload malicious content</li>
              <li>Attempt to gain unauthorized access to our systems</li>
              <li>Use the service for spam or misleading content</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">7. Limitation of Liability</h2>
            <p>
              Our service is provided "as is" without warranties. We are not liable for any 
              indirect, incidental, or consequential damages arising from your use of the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">8. Termination</h2>
            <p>
              We may terminate or suspend your account at any time for violations of these terms. 
              You may delete your account at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-2">9. Changes to Terms</h2>
            <p>
              We may modify these terms at any time. Continued use of the service after changes 
              constitutes acceptance of the new terms.
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
