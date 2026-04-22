import Image from "next/image";

export default function AuthLogo() {
  return (
    <Image
      src="/template images/logo (2).svg"
      alt="Article Generator logo"
      width={64}
      height={64}
      className="mx-auto mb-4 h-16 w-auto object-contain"
      priority
    />
  );
}
