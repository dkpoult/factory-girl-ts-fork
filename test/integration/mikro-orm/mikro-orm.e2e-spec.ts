import { MikroORM, wrap } from '@mikro-orm/core';
import { MikroOrmAdapter } from '@src/adapters/mikro-orm.adapter';
import { FactoryGirl } from '@src/factory-girl';
import { AddressEntity } from './address.entity';
import { addressSchema } from './address.schema';
import { BookEntity } from './book.entity';
import { bookSchema } from './book.schema';
import { PhoneUser } from './phone-user.entity';
import { UserProfileEntity } from './user-profile.entity';
import { userProfileSchema } from './user-profile.schema';
import { UserEntity } from './user.entity';
import { userSchema } from './user.schema';

let orm: MikroORM;

describe('Mikro Orm Integration', () => {
  const buildUserDefaultAttributes = () => ({
    email: 'mikro-orm@mail.com',
    name: 'Mikro Orm',
    address: null,
    phone: null,
  });

  const userFactory = FactoryGirl.define(
    UserEntity,
    buildUserDefaultAttributes,
  );

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: 'postgresql://postgres:pass123@localhost:5432/postgres',
      schema: 'mikro',
      entities: [userSchema, addressSchema, bookSchema, userProfileSchema],
      type: 'postgresql',
    });

    await orm.getSchemaGenerator().updateSchema({
      safe: true,
    });

    FactoryGirl.setAdapter(new MikroOrmAdapter(orm));
  });

  afterEach(async () => {
    await orm.getSchemaGenerator().refreshDatabase();
  });

  describe('create', () => {
    test('creates a user', async () => {
      const user = await userFactory.create();

      expect(user).toEqual({
        id: expect.any(Number),
        ...buildUserDefaultAttributes(),
      });
    });

    test('creates many users', async () => {
      // Arrange
      await userFactory.createMany(2, [
        {
          name: 'User 1',
        },
        {
          name: 'User 2',
          phone: 'phone',
        },
      ]);

      // Act
      const users = await findUsers();

      // Assert
      expect(users).toHaveLength(2);
      expect(users).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'User 1',
          }),
          expect.objectContaining({
            name: 'User 2',
            phone: 'phone',
          }),
        ]),
      );
    });

    test('creates a user with null attribute', async () => {
      // Arrange
      const userFactoryWithNull = FactoryGirl.define(UserEntity, () => {
        return {
          name: 'User',
          email: 'mail@mail.com',
          phone: null,
        };
      });

      // Act
      const userWithNullName = await userFactoryWithNull.create({
        phone: '+55 11 99999-9999',
      });

      expect(userWithNullName).toEqual({
        id: expect.any(Number),
        name: 'User',
        email: 'mail@mail.com',
        phone: '+55 11 99999-9999',
      });
    });

    test('creates a user with overwritten attributes', async () => {
      const user = await userFactory.create({
        email: 'custom-email@mail.com',
      });

      expect(user).toEqual({
        ...buildUserDefaultAttributes(),
        id: expect.any(Number),
        email: 'custom-email@mail.com',
      });
    });

    test('creates a user in the database', async () => {
      // Arrange
      const user = await userFactory.create();

      // Act
      const userInDatabase = await findUserById(user.id);

      // Assert
      expect(userInDatabase).toEqual(user);
    });

    test('creates a user with afterCreate hook', async () => {
      // Arrange
      const userFactoryWithAfterHook = userFactory.afterCreate(
        async (user, adapter) => {
          wrap(user).assign({
            name: 'Mikro Orm After Hook',
          });
          await adapter.save(user);
          return user;
        },
      );

      // Act
      const user = await userFactoryWithAfterHook.create();

      // Assert
      expect(user).toEqual({
        id: expect.any(Number),
        ...buildUserDefaultAttributes(),
        name: 'Mikro Orm After Hook',
      });
    });

    test('creates a user with an extended factory', async () => {
      // Arrange
      const userFactoryWithAfterHook = userFactory.extend(async () => ({
        name: 'Extended Name',
      }));

      // Act
      const user = await userFactoryWithAfterHook.create();

      // Assert
      expect(user).toEqual({
        id: expect.any(Number),
        ...buildUserDefaultAttributes(),
        name: 'Extended Name',
      });
    });

    test('creates an address with a relationship', async () => {
      const addressFactory = FactoryGirl.define(AddressEntity, () => ({
        city: 'Mikro Orm City',
        user: userFactory.associate(),
      }));

      const address = await addressFactory.create();

      expect(address).toEqual({
        id: expect.any(Number),
        city: 'Mikro Orm City',
        user: {
          id: expect.any(Number),
          name: expect.any(String),
          email: expect.any(String),
          address: expect.any(AddressEntity),
          phone: null,
        },
      });
    });

    test('creates a subclass of User using mutate', async () => {
      // Arrange
      const phoneUserFactory = userFactory.mutate<PhoneUser>(
        (user) => new PhoneUser(user.id, user.phone as string),
      );

      // Act
      const phoneUser = await phoneUserFactory.create({
        phone: '+55 11 99999-9999',
      });

      // Assert
      expectTypeOf(phoneUser).toEqualTypeOf<PhoneUser>();
      expect(phoneUser).toEqual({
        id: expect.any(Number),
        phone: '+55 11 99999-9999',
      });
    });

    test('creates an entity using custom association attributes', async () => {
      // Arrange
      const bookFactory = FactoryGirl.define(BookEntity, () => ({
        name: 'book',
        authorId: userFactory.associate('id', {
          name: 'Custom Association Name',
        }),
      }));

      // Act
      const book = await bookFactory.create();

      // Assert
      const user = await findUserById(book.authorId);
      expect(user).toEqual({
        ...buildUserDefaultAttributes(),
        id: expect.any(Number),
        name: 'Custom Association Name',
      });
    });

    test('creates an entity with many references to the same association', async () => {
      // Arrange
      const userProfileFactory = FactoryGirl.define(UserProfileEntity, () => {
        const userAssociation = userFactory.associate();
        return {
          photo: 'photo',
          email: userAssociation.get('email'),
          userId: userAssociation.get('id'),
        };
      });

      // Act
      const userProfile = await userProfileFactory.create();

      // Assert
      const defaultUserAttributes = buildUserDefaultAttributes();
      expect(userProfile).toEqual({
        id: expect.any(Number),
        userId: expect.any(Number),
        email: defaultUserAttributes.email,
        photo: 'photo',
      });
    });
  });
});

async function findUserById(id: number) {
  return await orm.em.fork().findOne(UserEntity, id, {
    refresh: true,
  });
}

async function findUsers() {
  return await orm.em.fork().find(UserEntity, {});
}