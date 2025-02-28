import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const port = 3000;

const limiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 1, // Allow only 1 request per second
});

app.use(cors());
app.use(express.json());
//app.use('/process-text', limiter);




// Preprocess text: Clean and normalize
const preprocessText = (text) => {
  console.log("Step 1: Preprocessing text...");
  return text.replace(/\s+/g, ' ').trim();
};


//elements
const prompt = (text, inputWord) => {
  return `This is the text: ${text}. Extract relevant entities connected to ${inputWord} in JSON format. For each entity as well as for ${inputWord}, provide:
   
    name: The entity's name.
    description: A short definition or explanation.
    status: Its category or classification.
    parents: A list of superordinate concepts (e.g., broader categories or whole-part relationships).
    relations: A list of tuples describing non-hierarchical relationships with other entities (e.g., influences, dependencies).

    Here is an example so you have an idea, how the form could look like:
        
      "[
        {
          [
          "name": "car",
          "description": "A wheeled motor vehicle used for transportation, typically powered by an internal combustion engine or an electric motor, designed to carry a small number of passengers.",
          "status": "transportation mode",
          "parents": ["transportation", "vehicle"],
          "relations": [
              ["engine", "Powered by either internal combustion engines or electric motors"],
              ["hybrid_car", "Uses both traditional and electric propulsion systems"],
              ["autonomous_vehicle", "Can function independently without a human driver"]
          ]
        }
      ]"

    Ensure output is a valid JSON. Do not include extra text.

`}

//,"sequence": ["fast transportation", "long distance connectivity"]
  
// Also create sequences of several of the created entities that emerge from each other or can be described to follow aech oher in a sequence. Try to include more than 2 elements for each sequence. An element references the sequence element or several elements that follow it.
  
//reference to elements that follows sequenmtially

async function extractDeep(text, inputWord) {
  try {
    console.log("contextualising text...");
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'deepseek-r1:7b',
      prompt: prompt(text, inputWord),
      stream: false,
      temperature: 0.1
    });
   
    console.log("extracted:", response.data.response)

    const entities = parseEntities(response.data.response);
    return entities;
  } catch (error) {
    console.error('Error during entity extraction:', error);
    throw new Error('Entity extraction failed');
  }
}


//sequence
const seqPrompt = (text, ent) => {
  return ` 
Based on the following text: "${text}", create sequences of entities from the list: ${JSON.stringify(ent.map(e => e.name))}. 

Each sequence should be a logical progression of related entities, where one follows naturally from the other. Try to include at least 3 entities per sequence.

Return only a valid JSON array of arrays, without any extra text:  
[
  ["entity1", "entity2", "entity3"],
  ["entity1", "entity5", "entity3"],
  ["entity4", "entity5", "entity6"]
]

Ensure the output is valid JSON.`;
}


async function extractSequence(text, ent) {
  try {
    console.log("Step s: Fetching sequences");
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'deepseek-r1:7b',
      prompt: seqPrompt(text, ent),
      stream: false,
      temperature: 0.1
    });

    console.log("Extracted sequences:", response.data.response);

    const sequences = parseEntities(response.data.response);

    //ensure JSON
    // const jsonText = response.data.response.trim();
    // // const sequ = sanitizeJSON(jsonText);
    // const sequences = JSON.parse(jsonText);
    
    console.log("cleaned sequences:", sequences);
    return sequences;
  } catch (error) {
    console.error('Error during entity extraction:', error);
    throw new Error('Entity extraction failed');
  }
}




function parseEntities(responseText) {
  // Find the first '[' character, indicating the start of a JSON array
  const startIndex = responseText.indexOf('[');
  if (startIndex === -1) {
    console.error("No JSON array found in response.");
    return [];
  }

  // Use a counter to find the matching closing ']'
  let bracketCount = 0;
  let endIndex = -1;
  for (let i = startIndex; i < responseText.length; i++) {
    const char = responseText[i];
    if (char === '[') {
      bracketCount++;
    } else if (char === ']') {
      bracketCount--;
      if (bracketCount === 0) {
        endIndex = i;
        break;
      }
    }
  }

  if (endIndex === -1) {
    console.error("Could not find a matching closing bracket.");
    return [];
  }

  // Extract the JSON substring
  const jsonString = responseText.substring(startIndex, endIndex + 1).trim();

  // Optionally, remove unwanted escapes or whitespace issues
  let sanitizedString = jsonString
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .replace(/\\'/g, "'")  // Unescape single quotes
    .replace(/\\"/g, '"')  // Unescape double quotes
    .replace(/<\/?think>/gi, '') // Remove any `<think>` tags if present
    .replace(/\n/g, '');  // Remove newlines

  // Check for common issues in the JSON structure
  // 1. Missing commas
  sanitizedString = sanitizedString.replace(/}\s*{/g, '}, {'); // Fix missing commas between objects
  // 2. Trailing commas (e.g., after the last item in an array)
  sanitizedString = sanitizedString.replace(/,(\s*[\}\]])/g, '$1'); // Remove trailing commas

  // 3. Fix malformed entity values (for example, strings that aren't properly quoted)
  sanitizedString = sanitizedString.replace(/(\w+):\s*([\w\s]+)/g, '"$1": "$2"'); // Ensuring keys and values are quoted correctly

  // Try to parse the JSON string
  try {
    const parsed = JSON.parse(sanitizedString);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    console.error("Error parsing JSON:", error);
    console.log("Sanitized response that failed to parse:", sanitizedString);
    return [];
  }
}



//main
app.post('/process-text', async (req, res) => {
  console.log(`New request received at ${new Date().toISOString()}`);

  try {
    const { text, selectedInput } = req.body;
    if (!text || !selectedInput) {
      return res.status(400).json({ error: 'Text and Input Word are required' });
    }

    let cleanedText = preprocessText(text);
    const contextualised = await extractDeep(cleanedText, selectedInput);
    
    if (!Array.isArray(contextualised) || contextualised.length === 0) {
      throw new Error('Invalid LLM response format');
    }

    // Extract sequence
    const sequences = await extractSequence(cleanedText, contextualised);
    if (Array.isArray(sequences) && sequences.length > 0) {
      sequences.forEach(seq => {
        for (let i = 0; i < seq.length - 1; i++) {
          const currentEntity = contextualised.find(e => e.name === seq[i]);
          const nextEntity = contextualised.find(e => e.name === seq[i + 1]);

          if (currentEntity) {
            currentEntity.sequence = currentEntity.sequence || [];
            currentEntity.sequence.push(nextEntity ? nextEntity.name : null);
          }
        }
      });
    }

    // Return only the array of entities
    res.json(contextualised);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});



// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
