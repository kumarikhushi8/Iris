import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        token.githubId = profile.id;
        token.login = (profile as any).login;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).githubId = token.githubId;
      (session as any).login = token.login;
      return session;
    },
  },
});
