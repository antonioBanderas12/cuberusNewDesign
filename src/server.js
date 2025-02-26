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
const prompt = (text) => {
  return `This is the text: ${text}. I want a summary of the text as an arraylist back in the following form. Do not write any additional text, just give me the arraylist: I want you to extend and enhance this list with contents from the article. Here are the descriptions of the attributes: [entity name; entity description; status or group of the entity; references to one or more other entities created that resemble superordinate concepts or entities like a parent-child relationship or a whole-part relationship,where always the bigger or superordinate is represented; a list of tuples that consist of one reference to another created entity and a matching description where dynamics and relationships that are not hierarchical should be described for example the way one entity changes another one].
  
  Try to not assign many statuses, but rateher give the same status to several entities.

  An object can have several parents. Try to use the given entities as parents. A tree-like structure over several levels should emerge.
  
  Here is an example so you have an idea, how the form could look like:
  "[
      {
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

Give at least 15 different entities.

Ensure output is a valid JSON. Do not include extra text.

`}

//,"sequence": ["fast transportation", "long distance connectivity"]
  
// Also create sequences of several of the created entities that emerge from each other or can be described to follow aech oher in a sequence. Try to include more than 2 elements for each sequence. An element references the sequence element or several elements that follow it.
  
//reference to elements that follows sequenmtially

async function extractDeep(text) {
  try {
    console.log("Step 3a: Fetching entity extraction from LLM");
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'deepseek-r1:7b',
      prompt: prompt(text),
      stream: true,
      temperature: 0.1
    });
   
    console.log("extracted entities", response.data.response)

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
  ["entity4", "entity5", "entity6"]
]

Ensure the output is valid JSON.`;
}


async function extractSequence(text, ent) {
  try {
    console.log("Step 3b: Fetching sequences");
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
    
    console.log("Extracted sequences:", sequences);
    return sequences;
  } catch (error) {
    console.error('Error during entity extraction:', error);
    throw new Error('Entity extraction failed');
  }
}





function parseEntities(responseText) {
  // Find the first '[' character
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
  const sanitizedString = jsonString
    .replace(/\s+/g, ' ')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/<\/?think>/gi, '')
    .replace(/\n/g, ''); // Remove newlines



    console.log("san: ", sanitizedString)

  try {
    const parsed = JSON.parse(sanitizedString);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    console.error("Error parsing JSON:", error);
    console.log("Sanitized response that failed to parse:", sanitizedString);
    return [];
  }
}





// function parseEntities(responseText){
//     try {
//         // Remove any text before the first '[' and after the last ']'
//         const jsonString = responseText.replace(/^[^[]*/, '').replace(/][^]*$/, ']');
        
//         // Remove newlines and extra spaces, and escape special characters
//         const sanitizedString = jsonString
//             .replace(/\s+/g, ' ') // Replace multiple whitespace with a single space
//             .replace(/\\'/g, "'") // Replace escaped single quotes
//             .replace(/\\"/g, '"') // Replace escaped double quotes
//             .replace(/\n/g, '') // Remove newlines
//             .replace(/\r/g, '') // Remove carriage returns
//             .replace(/\t/g, ''); // Remove tabs
        
// console.log("san: ", sanitizeJSON)

//         // Parse the sanitized JSON string
//         const parsed = JSON.parse(sanitizedString);
        
//         // Ensure the result is an array
//         return Array.isArray(parsed) ? parsed : [parsed];
//     } catch (error) {
//         console.error("Error parsing entities:", error);
//         console.log("Problematic response:", responseText);
//         return []; // Return empty array to prevent crashes
//     }

// };



function sanitizeJSON(responseText) {
  try {
      // Remove anything before the first '[' to get a valid JSON structure
      const jsonStartIndex = responseText.indexOf("[");
      if (jsonStartIndex === -1) throw new Error("No JSON found in response");

      const jsonText = responseText.slice(jsonStartIndex).trim();
      
      return JSON.parse(jsonText);
  } catch (error) {
      console.error("Error parsing JSON:", error);
      throw new Error("Failed to parse JSON");
  }
}







//main
app.post('/process-text', async (req, res) => {
  console.log(`New request received at ${new Date().toISOString()}`);
  try {
    console.log("===== New Request Received =====");
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text input is required' });
    }

    //preprocess
    const cleanedText = preprocessText(text);


    //console.log("Calling extractDeep with text:", cleanedText);
    //fetch entities
    const entities = await extractDeep(cleanedText);


    console.log("Calling extractSequence with entities:", entities);
    //fetch sequences
    const sequence = await extractSequence(cleanedText, entities)


    console.log(entities)
    console.log(sequence)


    //merge
    const entityMap = Object.fromEntries(entities.map(e => [e.name, { ...e, sequence: null }]));
    sequence.forEach(seq => {
      for (let i = 0; i < seq.length - 1; i++) {
        if (entityMap[seq[i]]) {
          entityMap[seq[i]].sequence = entityMap[seq[i]].sequence || [];
          entityMap[seq[i]].sequence.push(seq[i + 1]);
        }
      }
    });




    //finale
    const updatedEntities = Object.values(entityMap);
    console.log("Final response prepared:", updatedEntities);

    res.json(updatedEntities);

  } catch (error) {
    console.error('Error during text processing:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});






// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
