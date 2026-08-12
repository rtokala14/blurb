import { describe, expect, it } from 'bun:test'
import { parseConnectionString } from '../../src/server/db/connection'

/**
 * A parsing bug here surfaces as "cannot connect" in production, so both
 * accepted forms are pinned down.
 */
describe('parseConnectionString', () => {
  it('parses the ADO.NET string the Azure portal hands you', () => {
    expect(
      parseConnectionString(
        'Server=tcp:srv.database.windows.net,1433;Initial Catalog=appdb;' +
          'User ID=app_user;Password=s3cret;Encrypt=True;TrustServerCertificate=False;' +
          'Connection Timeout=30;',
      ),
    ).toEqual({
      server: 'srv.database.windows.net',
      port: 1433,
      database: 'appdb',
      user: 'app_user',
      password: 's3cret',
      encrypt: true,
      trustServerCertificate: false,
    })
  })

  it('accepts ADO aliases and is case-insensitive about keys', () => {
    const connection = parseConnectionString(
      'DATA SOURCE=localhost;database=app;uid=sa;pwd=pw;encrypt=false',
    )
    expect(connection).toMatchObject({
      server: 'localhost',
      port: 1433,
      database: 'app',
      user: 'sa',
      encrypt: false,
    })
  })

  it('parses the URL form, including an encoded password', () => {
    expect(
      parseConnectionString(
        'mssql://sa:p%40ss%3Aword@localhost:14330/app?encrypt=true&trustServerCertificate=true',
      ),
    ).toEqual({
      server: 'localhost',
      port: 14330,
      database: 'app',
      user: 'sa',
      password: 'p@ss:word',
      encrypt: true,
      trustServerCertificate: true,
    })
  })

  it('defaults encryption on — Azure SQL refuses unencrypted connections', () => {
    expect(parseConnectionString('Server=h;Database=d;User ID=u;Password=p').encrypt).toBe(true)
    expect(parseConnectionString('mssql://u:p@h/d').encrypt).toBe(true)
  })

  it('falls back to the default port when none is given', () => {
    expect(parseConnectionString('Server=tcp:h;Database=d;User ID=u;Password=p', 1444).port).toBe(
      1444,
    )
  })

  it('rejects a string that is missing required parts', () => {
    expect(() => parseConnectionString('Server=h;Database=d')).toThrow(/missing: user, password/)
  })
})
