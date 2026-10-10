
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());


const db = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT) || 5432
      }
);


// Test database connection
db.connect()
    .then(client => {
        console.log("PostgreSQL connected successfully!");
        client.release();
    })
    .catch(err => {
        console.error("Database connection failed:", err.message);
    });

// Home page
app.get("/", (req, res) => {
    res.send("Contact Management Backend is running!");
});

// Get all contacts
app.get("/contacts", async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                c.contact_id AS id,
                c.name,
                c.phone,
                c.email,
                c.address,
                c.birthday,
                c.company,
                c.is_favourite AS favourite,
                COALESCE(g.group_name, 'Personal') AS category
            FROM contacts c
            LEFT JOIN LATERAL (
                SELECT gr.group_name
                FROM contact_group cg
                JOIN groups gr ON gr.group_id = cg.group_id
                WHERE cg.contact_id = c.contact_id
                ORDER BY gr.group_id
                LIMIT 1
            ) g ON TRUE
            ORDER BY c.name
        `);

        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Could not fetch contacts" });
    }
});

// Add a contact
app.post("/contacts", async (req, res) => {
    const {
        name, phone, email, address,
        birthday, company, category
    } = req.body;

    if (!name || !phone || !email) {
        return res.status(400).json({
            error: "Name, phone and email are required"
        });
    }

    const client = await db.connect();

    try {
        await client.query("BEGIN");

        const duplicate = await client.query(
            `SELECT contact_id FROM contacts
             WHERE phone = $1 OR LOWER(email) = LOWER($2)`,
            [phone, email]
        );

        if (duplicate.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                error: "Phone number or email already exists"
            });
        }

        const result = await client.query(
            `INSERT INTO contacts
             (name, phone, email, address, birthday, company)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING contact_id AS id`,
            [
                name, phone, email, address || null,
                birthday || null, company || null
            ]
        );

        const contactId = result.rows[0].id;
        const groupName = category || "Personal";

        const group = await client.query(
            `INSERT INTO groups (group_name)
             VALUES ($1)
             ON CONFLICT (group_name)
             DO UPDATE SET group_name = EXCLUDED.group_name
             RETURNING group_id`,
            [groupName]
        );

        await client.query(
            `INSERT INTO contact_group (contact_id, group_id)
             VALUES ($1, $2)`,
            [contactId, group.rows[0].group_id]
        );

        await client.query("COMMIT");

        res.status(201).json({
            id: contactId,
            name, phone, email, address,
            birthday, company,
            category: groupName,
            favourite: false
        });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(err.message);
        res.status(500).json({ error: "Could not add contact" });
    } finally {
        client.release();
    }
});

// Update a contact
app.put("/contacts/:id", async (req, res) => {
    const { id } = req.params;
    const {
        name, phone, email, address,
        birthday, company, category
    } = req.body;

    const client = await db.connect();

    try {
        await client.query("BEGIN");

        const duplicate = await client.query(
            `SELECT contact_id FROM contacts
             WHERE (phone = $1 OR LOWER(email) = LOWER($2))
             AND contact_id <> $3`,
            [phone, email, id]
        );

        if (duplicate.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                error: "Phone number or email already exists"
            });
        }

        const result = await client.query(
            `UPDATE contacts SET
                name = $1, phone = $2, email = $3,
                address = $4, birthday = $5, company = $6
             WHERE contact_id = $7
             RETURNING contact_id`,
            [
                name, phone, email, address || null,
                birthday || null, company || null, id
            ]
        );

        if (result.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Contact not found" });
        }

        await client.query(
            "DELETE FROM contact_group WHERE contact_id = $1",
            [id]
        );

        const group = await client.query(
            `INSERT INTO groups (group_name)
             VALUES ($1)
             ON CONFLICT (group_name)
             DO UPDATE SET group_name = EXCLUDED.group_name
             RETURNING group_id`,
            [category || "Personal"]
        );

        await client.query(
            `INSERT INTO contact_group (contact_id, group_id)
             VALUES ($1, $2)`,
            [id, group.rows[0].group_id]
        );

        await client.query("COMMIT");
        res.json({ message: "Contact updated successfully" });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(err.message);
        res.status(500).json({ error: "Could not update contact" });
    } finally {
        client.release();
    }
});

// Mark or unmark favourite
app.patch("/contacts/:id/favourite", async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE contacts
             SET is_favourite = NOT is_favourite
             WHERE contact_id = $1
             RETURNING contact_id AS id,
                       is_favourite AS favourite`,
            [req.params.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Contact not found" });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Could not update favourite" });
    }
});

// Delete a contact
app.delete("/contacts/:id", async (req, res) => {
    try {
        const result = await db.query(
            "DELETE FROM contacts WHERE contact_id = $1 RETURNING contact_id",
            [req.params.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Contact not found" });
        }

        res.json({ message: "Contact deleted successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Could not delete contact" });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
