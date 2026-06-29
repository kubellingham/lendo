import { NextResponse } from 'next/server';
import { auth } from './lib/auth';

export default auth((req) => {
  const isAuth = !!req.auth;
  const { pathname } = req.nextUrl;
  const isPublic = pathname.startsWith('/login') || pathname.startsWith('/api/auth');
  const isCron = pathname.startsWith('/api/cron');

  if (isCron) return NextResponse.next();
  if (isPublic) return NextResponse.next();

  if (!isAuth) {
    const url = new URL('/login', req.nextUrl.origin);
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)'],
};
